# Plane Backend → NestJS + Mastra Replica — Design & Implementation Plan

This directory is the structured design for replacing the Plane **Django backend** (`apps/api`) with a
**NestJS** application in `apps/nestjs-api/`, using **Drizzle ORM**, a **Celery-compatible RabbitMQ** layer,
and **Mastra AI** — as a **drop-in replacement** on the same PostgreSQL / RabbitMQ / Redis / S3.

> Goal source: [`../current_goal`](../current_goal).

## The design set (read in order)

| Doc | What it covers |
|---|---|
| [`00-overview.md`](./00-overview.md) | Goal, scope, locked decisions, the 4 HTTP surfaces, tech stack, Django→NestJS module map. |
| [`01-architecture.md`](./01-architecture.md) | Module decomposition, the three run modes (`main`/`worker`/`scheduler`), request lifecycle, config, monorepo integration, component diagram. |
| [`02-data-layer-drizzle.md`](./02-data-layer-drizzle.md) | The ~90-model port: schema mirroring, base-mixin replication (`BaseRepository` + `nestjs-cls`), soft-delete/audit/tenancy, advisory-lock sequence, cascade registry, introspect + CI drift gate. |
| [`03-auth-and-rbac.md`](./03-auth-and-rbac.md) | Drop-in dual-cookie sessions (Django-exact crypto), API-key auth + throttle, RBAC (both DRF classes **and** `@allow_permission`), `/auth` + `/api/instances` endpoints. |
| [`04-api-surface.md`](./04-api-surface.md) | Controller layout, route mount map, cursor + grouped pagination, `fields`/`expand` serialization, the four error envelopes. |
| [`05-background-jobs.md`](./05-background-jobs.md) | Celery-protocol-v2 producer/consumer over `amqplib`, golden-message parity, beat scheduler, 47-task inventory, the two-engine fan-out, per-queue cutover. |
| [`06-ai-mastra.md`](./06-ai-mastra.md) | The Mastra `AiModule`: two `ai-assistant/` endpoints, Fernet config parity, provider modes A/B, Unsplash proxy. |
| [`07-infra-and-integrations.md`](./07-infra-and-integrations.md) | Database, cache/Redis, S3 storage, mailer, live-service client, config/secrets, CORS, observability, env parity. |
| [`08-implementation-roadmap.md`](./08-implementation-roadmap.md) | Phased build (Phase 0–7), per-phase exit criteria, and the route/task/beat cutover strategy. |
| [`09-risks-and-open-questions.md`](./09-risks-and-open-questions.md) | Ranked risks + mitigations and open questions needing product/ops input. |

## Key facts at a glance

- **Scale:** ~90 models (121 migrations); ~300+ endpoints across 4 surfaces; 47 Celery tasks + 12 beat entries;
  AI = one completion call.
- **Locked decisions:** drop-in replacement · Drizzle ORM · keep RabbitMQ (Celery-compatible) · full design, phased build.
- **Two hardest problems, both solved in design:**
  - *Session drop-in* — the `session-id` cookie is the **raw unsigned** session key and the row denormalizes
    `user_id`, so NestJS authenticates existing users with zero crypto ([`03`](./03-auth-and-rbac.md) §0).
  - *Task coexistence* — a hand-rolled Celery-protocol-v2 layer + golden-message parity + per-queue cutover
    lets Django and NestJS workers share the broker ([`05`](./05-background-jobs.md) §1).
- **Realtime** stays with `apps/live` (API calls `/convert-document/` only).

## Verification (the acceptance backbone)

Every doc ends with a **fidelity checklist**. The cross-cutting golden tests are:
1. Session round-trip (Django cookie ↔ NestJS). 2. Celery golden-message + cross-execution.
3. Schema drift gate (CI). 4. Fernet config parity. 5. Wire golden-response parity. 6. Side-effect parity.

## Status & next step

This is the **design + implementation-plan deliverable**. No application code has been written yet.
The recommended next step is **Phase 0** (foundation/infra) from [`08-implementation-roadmap.md`](./08-implementation-roadmap.md),
which retires the two highest risks (session parity, Celery message parity) first.

Every technical claim here is traced to a source file (often a line) in `apps/api`, so the design is
auditable against the real code.
