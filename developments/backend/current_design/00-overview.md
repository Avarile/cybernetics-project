# 00 — Overview

> **NestJS + Mastra AI drop-in replacement for the Plane Django backend (`apps/api`)**
> Design deliverable for `apps/nestjs-api/`. This document set is the blueprint; the code build is
> phased (see [`08-implementation-roadmap.md`](./08-implementation-roadmap.md)).

## 1. Goal

Replicate the existing Python/Django backend in `apps/api` as a NestJS application in `apps/nestjs-api/`,
**completely reproducing its functions and HTTP APIs**, using **Drizzle ORM** for data access, **RabbitMQ
with Celery-compatible messages** for background work, and **Mastra AI** for the (small) AI surface —
following NestJS best practices.

The target is a **drop-in replacement**: it runs against the *same* PostgreSQL database, RabbitMQ broker,
Redis, and S3, and matches the *exact* wire contracts (endpoint paths, request/response JSON, session
cookie, API-key header) so the existing `web`, `space`, and `admin` frontends — and any external API
consumers — keep working **unchanged**.

## 2. What `apps/api` actually is

Plane is one of the largest open-source Django applications. The scope this design must cover:

| Dimension | Size / shape |
|---|---|
| **Data models** | ~90 concrete models across 34 files in `plane/db/models/`; **121 migrations**; UUID PKs everywhere; pervasive soft-delete + audit mixins; `workspace → project → entity` tenancy. |
| **HTTP surfaces** | **4** distinct mounts (see §4). ~233 internal app routes + ~67 external v1 routes + the public "spaces" API + auth/instance-admin. |
| **Auth** | DB-backed **dual-cookie sessions** (`session-id` / `admin-session-id`), **magic-code OTP** (Redis), **OAuth** (Google/GitHub/GitLab/Gitea), opaque **API keys** (`X-Api-Key`). **No JWT.** |
| **Background** | **47 live Celery tasks** on **RabbitMQ** + **12 beat (periodic) entries**. No result backend (fire-and-forget). |
| **AI** | *Tiny.* One provider-configurable chat-completion call behind **two** `ai-assistant/` endpoints. No embeddings/RAG/vector search. |
| **Realtime** | Owned by the separate **`apps/live`** service (Hocuspocus/Yjs). The API only calls its `POST /convert-document/`. Not reimplemented here. |

## 3. Locked decisions

These were confirmed with the requester and drive the whole design:

1. **Drop-in replacement** on the existing Postgres DB — map to Django `db_table`/column names, match wire
   contracts exactly. No data migration; existing logged-in users stay logged in.
2. **Drizzle ORM** — SQL-first. Because Drizzle has no Prisma-style middleware, Django's base-model
   behaviors (audit stamping, soft-delete, tenancy) become **explicit service-layer patterns** centralized
   in a `BaseRepository` (see [`02`](./02-data-layer-drizzle.md)).
3. **Keep RabbitMQ** with **Celery-protocol-v2-compatible** messages, so Django Celery workers and NestJS
   workers can **coexist** and tasks can be cut over one queue at a time (see [`05`](./05-background-jobs.md)).
4. **Full design now, phased build later.** Every layer is designed; implementation is staged (Phase 0–7).

## 4. The four HTTP surfaces (mount map)

Reproduced exactly from `plane/urls.py`:

| Mount prefix | Django module | Auth | Notes |
|---|---|---|---|
| `/api/` | `plane.app.urls` | session cookie (`session-id`) | Internal/frontend API — the bulk (~233 routes). `DynamicBaseSerializer` (`?fields`/`?expand`), cursor pagination. |
| `/api/public/` | `plane.space.urls` | session cookie + **anonymous** anchor access | Public "spaces" (published boards/pages); anon users can vote/react/comment. |
| `/api/instances/` | `plane.license.urls` | session cookie (`admin-session-id`) | Instance/license admin ("god mode"); the **1-hour admin cookie**, selected by `"instances" in path`. |
| `/api/v1/` | `plane.api.urls` | **API key** (`X-Api-Key`) + `ApiKeyRateThrottle` | External/public REST API (~67 routes). No `filter_backends`; manual querysets. |
| `/auth/` | `plane.authentication.urls` | none (creates sessions) | Login / OAuth / magic / password mgmt / signout / CSRF. Mostly 302-redirect flows. |

Optionally `/api/schema/`, `/swagger-ui/`, `/redoc/` (drf-spectacular) behind `ENABLE_DRF_SPECTACULAR`.

## 5. Target technology stack

| Concern | Django (`apps/api`) | NestJS (`apps/nestjs-api`) |
|---|---|---|
| Framework | Django 4.2 + DRF 3.15 | **NestJS 10** (Express adapter) |
| Language/runtime | Python 3 | **TypeScript / Node** (ESM, mirror `apps/live`) |
| ORM / DB | Django ORM + psycopg (Postgres) | **Drizzle ORM** + `postgres-js`/`pg` (same Postgres) |
| Migrations | Django (121 migrations) | **Django keeps owning DDL**; Drizzle is DML-only + introspection + CI drift gate |
| Request context | `crum` thread-local current user | **`nestjs-cls`** (AsyncLocalStorage) |
| Sessions | custom DB session engine, dual cookie | Drizzle-backed `SessionService` + `SessionGuard` (Django-exact crypto) |
| Background jobs | Celery 5 + RabbitMQ + beat | **Celery-protocol producer/consumer over `amqplib`** + `@nestjs/schedule` beat |
| Cache / locks / OTP | `django-redis` | **`ioredis`** |
| Object storage | `django-storages` + boto3 (S3/MinIO) | **`@aws-sdk/client-s3`** |
| Email | Django SMTP + templates | **`nodemailer`** + template engine (config from `InstanceConfiguration`) |
| AI | OpenAI SDK (multi-provider via LiteLLM prefix) | **Mastra AI** `Agent` + Vercel AI SDK providers |
| Secrets/config | `InstanceConfiguration` + Fernet | `InstanceConfigService` + Fernet-parity `CryptoService` |
| Observability | OpenTelemetry + JSON logging + Scout APM | OpenTelemetry Node SDK + `nestjs-pino` |
| Schema docs | drf-spectacular | `@nestjs/swagger` |

## 6. Source → target module mapping (index)

| Django (`plane/…`) | NestJS (`apps/nestjs-api/src/…`) | Design doc |
|---|---|---|
| `db/models/*`, `db/mixins.py` | `infra/database` + `modules/*/*.schema.ts`, `*.repository.ts` | [`02`](./02-data-layer-drizzle.md) |
| `authentication/*` | `modules/auth`, `infra/auth` (guards) | [`03`](./03-auth-and-rbac.md) |
| `app/permissions/*` | `infra/rbac` (`@Roles`, `RbacGuard`, `MemberService`) | [`03`](./03-auth-and-rbac.md) |
| `app/views/*`, `app/urls/*`, `app/serializers/*` | `modules/{workspace,project,issue,cycle,module,page,view,intake,state,estimate,label,notification,analytics,search,asset,webhook,api-token,user}` | [`04`](./04-api-surface.md) |
| `api/views/*` (v1) | `modules/public-api` | [`04`](./04-api-surface.md) |
| `space/*` | `modules/space` | [`04`](./04-api-surface.md) |
| `utils/paginator.py` | `infra/pagination` | [`04`](./04-api-surface.md) |
| `app/serializers/base.py` (Dynamic) | `infra/serialization` (fields/expand interceptor) | [`04`](./04-api-surface.md) |
| `celery.py`, `bgtasks/*`, `license/bgtasks/*` | `infra/queue` + `modules/*/*.processor.ts`, `worker.ts`, `scheduler.ts` | [`05`](./05-background-jobs.md) |
| `app/views/external/base.py` | `modules/ai` (Mastra) | [`06`](./06-ai-mastra.md) |
| `license/*` | `modules/license` (instance admin, telemetry) + `infra/config` | [`03`](./03-auth-and-rbac.md), [`07`](./07-infra-and-integrations.md) |
| `settings/storage.py`, S3 tasks | `infra/storage` | [`07`](./07-infra-and-integrations.md) |
| `bgtasks/copy_s3_object.py` → live | `infra/live-service` | [`07`](./07-infra-and-integrations.md) |
| `settings/common.py` | `infra/config`, `main.ts` bootstrap | [`01`](./01-architecture.md), [`07`](./07-infra-and-integrations.md) |

## 7. Non-goals

- **Realtime collaboration** (`apps/live`) is not reimplemented; the API integrates with it via HTTP.
- **Django migrations** are not replaced — Django remains the single writer of DDL during and after the
  port (Drizzle mirrors the schema; see [`02`](./02-data-layer-drizzle.md) §5).
- **AI feature expansion** — Mastra reproduces the *existing* single completion behavior only; no new
  embeddings/RAG is introduced (that would be a separate product decision).

## 8. How to read this set

- [`01-architecture.md`](./01-architecture.md) — module layout & runtime processes.
- [`02-data-layer-drizzle.md`](./02-data-layer-drizzle.md) — the ORM/data layer (the largest port).
- [`03-auth-and-rbac.md`](./03-auth-and-rbac.md) — sessions, API keys, permissions, auth endpoints.
- [`04-api-surface.md`](./04-api-surface.md) — controllers, pagination, serialization, errors.
- [`05-background-jobs.md`](./05-background-jobs.md) — the Celery-compatible queue + tasks.
- [`06-ai-mastra.md`](./06-ai-mastra.md) — the Mastra AI module.
- [`07-infra-and-integrations.md`](./07-infra-and-integrations.md) — DB, cache, storage, mail, live, config.
- [`08-implementation-roadmap.md`](./08-implementation-roadmap.md) — the phased build plan.
- [`09-risks-and-open-questions.md`](./09-risks-and-open-questions.md) — risks, mitigations, open items.

Every technical claim in this set is traced to a source file (and often a line) in `apps/api`, so the
design is auditable against the real code.
