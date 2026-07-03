# 08 — Implementation Roadmap

A phased, reversible build. The whole strategy rests on running NestJS **beside** Django against the **same**
Postgres + RabbitMQ + Redis + S3, then cutting over **routes** (behind `apps/proxy`) and **tasks** (per
queue) incrementally. The fire-and-forget, no-result-backend queue design (see [`05`](./05-background-jobs.md))
makes task cutover safe; the shared unsigned session cookie (see [`03`](./03-auth-and-rbac.md)) makes route
cutover seamless for users.

## Implementation status (as built in `apps/nestjs-api`)

Verified continuously via `tsc` + `nest build` + vitest unit specs + a real-Postgres/Redis e2e suite
(`test/*.e2e.spec.ts`). Current green state: **218 unit tests + 45 e2e tests passing.**

| Phase | Status | Notes |
|---|---|---|
| 0 — Foundation/infra | ✅ Built | Drizzle + node-pg, ConfigService (dotenv), Crypto/Fernet parity, InstanceConfig, Redis, S3/MinIO, mailer, **RabbitMQ Celery-v2 producer/worker**, RabbitMQ-based scheduler (replaces `@nestjs/schedule`), AsyncLocalStorage request context. |
| 1 — Auth + RBAC | ✅ Built | Django-drop-in session (raw unsigned cookie), API-key guard + Redis throttle (fail-open), RBAC (`@Roles`/`RbacGuard`/`MemberService`), password/session crypto parity. |
| 2 — Core domains | ✅ Built | state, label, issue (advisory-lock sequence + pagination), cycle, module, estimate, view, page, intake, user, auth. |
| 3 — Activity spine | ✅ Built | issue-activity mapper port, notifications (fan-out + mentions + email digest), webhook engine (HMAC + SSRF guard + retry + logs), 10 transactional emails. |
| 4 — Scheduler + tasks | ✅ Built | beat entries, maintenance/cleanup/version-prune, telemetry stubs, asset s3 + live-service, tracking (recent-visited + link-title crawl). |
| 5 — v1 public API | ✅ Core built | work-items/states/labels/projects v1 (X-Api-Key + throttle). Remaining v1 sub-resources (cycles/modules/members/estimates/intake/search) follow the same thin-controller pattern. |
| 6 — Spaces (public/anon) | ✅ Built | DeployBoard anchor: authenticated anchor find-or-create + anonymous board reads (settings/meta/states/labels/issues) gated by `AnchorGuard`. |
| 7 — Analytics + instance + AI | ◑ Partial | **AI (Mastra) ✅** — both `ai-assistant/` endpoints + Unsplash proxy, exact contract/error parity, `getLlmConfig` validation parity, byte-faithful gateway routing via a Mastra `Agent` + OpenAI-compatible provider. **Instance bootstrap ✅** — `GET /api/instances/` (`{config, instance}`). **Deferred:** the analytics surface (`AnalyticView` CRUD + `AnalyticsEndpoint`/`DefaultAnalyticsEndpoint`/`ProjectStats`/6× advance-analytics), which shares one machinery — `issue_filters` + `build_graph_plot` + `VALID_ANALYTICS_FIELDS` over a richer Issue schema — and the instance-**admin** auth flows (admin sign-in/up/session, configuration `PATCH`, workspace availability). These are a coherent follow-on unit, best built together. |

### AI module — how Mastra is wired (implementation note)

Django's `get_llm_response` calls the OpenAI SDK (`OpenAI(api_key)`), whose base URL comes from the
environment — i.e. a LiteLLM/OpenAI-compatible gateway with the `gemini/<model>` prefix trick. The NestJS
build replicates this **byte-faithfully** with a Mastra `Agent` whose model is `createOpenAI({ apiKey,
baseURL })(modelId)` (`baseURL` = `LLM_GATEWAY_URL || OPENAI_BASE_URL`, else the real OpenAI API — matching
Django when unset). Mastra 1.49's `Agent` requires a top-level `id` in its config; the model call is
single-shot (`instructions: ""`, no temperature/streaming), and `response_html = text.replace(/\n/g, "<br/>")`.

## Sequencing principles

- **Retire the highest risks first** (Phase 0): session drop-in and Celery message parity — if either can't
  be proven, the whole approach needs revisiting.
- **Each phase is independently shippable** behind the proxy; nothing is a big-bang.
- **Parity is verified continuously** via golden tests (session round-trip, Celery golden-message, wire
  golden-response) — see the Verification section.
- **Django stays the source of truth for DDL** throughout; the drift gate (see [`02`](./02-data-layer-drizzle.md) §5)
  guards the schema.

## Phase 0 — Foundation / infra

**Build:** Nest bootstrap in `apps/nestjs-api` (mirror `apps/live` tooling — pnpm workspace, tsconfig, turbo,
Dockerfiles); `infra/database` (Drizzle client + core-table schema via `drizzle-kit pull`); `infra/config`
(`ConfigService`, `InstanceConfigService`, `CryptoService`); `infra/cache` (ioredis); `infra/storage` (S3);
`infra/mailer`; and the **`infra/queue`** module (`CeleryProducer`, `CeleryWorker`, `TaskHandlerRegistry`,
`CELERY_TASKS`); the three bootstraps (`main.ts`/`worker.ts`/`scheduler.ts`); `AllExceptionsFilter`; CORS;
`nestjs-cls` + `RequestContextInterceptor`.

**Exit criteria:**
- `CeleryProducer.enqueue` passes the **golden-message byte-parity test** against a Django-captured message.
- A **Django worker successfully runs a NestJS-enqueued** task (e.g. `stack_email_notification`), and a
  NestJS worker runs a Django-enqueued one.
- `CryptoService.decrypt` reads a real encrypted `InstanceConfiguration` row.
- `drizzle-kit pull` round-trips on a Django-migrated DB; CI drift gate is wired.

## Phase 1 — Auth + RBAC

**Build:** Drizzle schema for `sessions`, `api_tokens`, `users`, `workspaces`, `workspace_members`,
`projects`, `project_members`; `SessionService` + `SessionGuard` (Django-exact crypto); `ApiKeyGuard` +
`ApiKeyThrottleInterceptor`; `infra/rbac` (`ROLE`, `@Roles`, `RbacGuard`, class permission guards,
`MemberService`); the `user`/`workspace`/`project` membership read paths; the `AuthModule` + `InstanceModule`
endpoint skeletons.

**Exit criteria:**
- A **Django-issued `session-id` cookie authenticates** on NestJS end-to-end; a NestJS-issued session is
  Django-decodable.
- Permissioned CRUD on workspace/project works with the correct role semantics (incl. workspace-admin-in-project
  override + creator bypass).
- Email/password + magic sign-in create working sessions.

## Phase 2 — Core domains

**Build:** `issue` (incl. advisory-lock create, rich-text quad), `state`, `label`, `cycle`, `module`,
`estimate`, `view`, `page`, `intake` — full CRUD via repositories, with serializer/response **parity**
(cursor pagination, `?fields`/`?expand`). Grouped/sub-grouped issue-list paginators.

**Exit criteria:**
- Create/read/update/delete issues (and the other core entities) end-to-end with wire-identical responses
  (golden-response tests) — **side effects not yet wired**.
- Soft-delete + cascade behave like Django (cascade registry test passes).

## Phase 3 — Activity + notifications + webhooks (the spine)

**Build:** port the `issue_activity` audit engine (28-branch `ACTIVITY_MAPPER` + 12 `track_*`), `notifications`,
the transactional `mailer` tasks, and the webhook engine (`model_activity → webhook_activity → webhook_send_task`
with HMAC + SSRF pinned-fetch + retry/backoff + `WebhookLog`). Wire controller mutations to enqueue **both**
engines via `ActivityDispatcher`.

**Exit criteria:**
- A mutation produces **identical `IssueActivity`, `Notification`, and webhook deliveries** to Django.
- Notifications batch/stack correctly; webhook signatures + retries match.

## Phase 4 — Scheduler + remaining tasks

**Build:** stand up `scheduler.ts` (all 12 beat entries); port versioning, asset/s3 (incl. `LiveServiceClient`
for `/convert-document/`), export/analytics-export, deletion/cleanup, telemetry, seeding processors.

**Exit criteria:**
- Full periodic + background parity; beat runs on exactly one scheduler.
- **Per-queue cutover** demonstrated: a task fully owned by the NestJS worker with Django no longer consuming it.

## Phase 5 — v1 public API

**Build:** `public-api` module (API-token surface mirroring `plane/api/views`) reusing domain services with
v1 serializer shapes + the API-key auth/throttle stack + API-activity logging.

**Exit criteria:**
- External integrations work against NestJS `/api/v1/*` with identical responses + `X-RateLimit-*` headers.

## Phase 6 — Spaces (public / anonymous)

**Build:** `space` module (public project/issue/cycle/module/state/label/member views, anon vote/react/comment,
public intake) behind `AnchorGuard`.

**Exit criteria:**
- Published boards/pages served by NestJS at `/api/public/*` identically to Django; anon interactions work.

## Phase 7 — Analytics + license/instance + AI

**Build:** `analytics` (ORM-aggregation charts, advanced analytics, saved views, exports), `search`, the
`license`/instance admin surface + `push_instance_metrics` telemetry, and the **Mastra `AiModule`** +
Unsplash proxy.

**Exit criteria:**
- Feature-complete drop-in. Analytics numbers match; AI endpoints match the contract.
- **Django can be decommissioned** once every route and every queue is cut over.

## Cutover strategy (cross-phase)

1. **Routes** — shift prefixes/paths from Django to NestJS behind `apps/proxy`, coarse (whole prefix) or fine
   (individual paths). Sessions are shared, so users don't notice. Roll back by re-pointing the proxy.
2. **Tasks** — give NestJS-owned tasks a dedicated queue (`celery.node`); move Django workers off that queue
   and NestJS workers onto it, one task/queue at a time (see [`05`](./05-background-jobs.md) §1).
3. **Beat** — a single atomic switch (only one scheduler may run).
4. **Schema** — never forked; Django owns DDL; the drift gate prevents divergence.

## Rough effort shape (not a schedule)

Phases 0–1 are the trust-establishing core (highest risk, moderate size). Phase 2 is the largest by volume
(core CRUD + serializer parity across ~9 domains). Phase 3 is the most intricate logic (the audit/notification/
webhook spine). Phases 4–7 are mostly mechanical repetition of established patterns. Expect the data layer
(Phase 2) and the activity spine (Phase 3) to dominate total effort.

## Verification (applies to every phase)

Golden, comparison-based tests against the live Django behavior:
1. **Session round-trip** — Django cookie authenticates on NestJS; NestJS session decodes in Django.
2. **Celery golden-message** — byte-identical produced messages; cross-execution both directions.
3. **Schema drift gate** — CI: Django `migrate` → `drizzle-kit pull` → diff snapshot; any diff fails.
4. **Fernet config parity** — decrypt a Django-encrypted `InstanceConfiguration` value.
5. **Wire parity** — golden-response tests diffing NestJS vs Django JSON for representative endpoints
   (pagination envelope, fields/expand shaping, the four error envelopes, AI response shape).
6. **Side-effect parity** — after a mutation, assert identical `IssueActivity`/`Notification`/webhook rows.

Each design doc ends with its own fidelity checklist; those checklists are the acceptance criteria per phase.
