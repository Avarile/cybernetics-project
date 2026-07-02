# 01 — Architecture

How the NestJS application is structured: the module decomposition, the three runtime processes that
share one codebase, configuration, and the monorepo integration.

## 1. Guiding principles

- **One NestJS codebase, three run modes** — mirroring Django's single project run as `web` (WSGI/ASGI),
  `worker` (Celery), and `beat` (scheduler). Same modules, different `bootstrap`.
- **Feature modules per domain**, thin controllers, business logic in services, data access in repositories.
- **Shared concerns live in `src/infra/*`** and are consumed via DI, never duplicated.
- **Wire compatibility is a first-class constraint** — guards, interceptors, and filters exist specifically
  to reproduce DRF's observable behavior (auth, pagination envelope, field shaping, error shapes).
- **Follow the existing monorepo** (`apps/live` is the TS/ESM precedent): pnpm workspace, turbo, tsconfig,
  Dockerfiles.

## 2. Directory layout

```
apps/nestjs-api/
  package.json                 # workspace member (mirror apps/live)
  tsconfig.json  tsconfig.build.json
  nest-cli.json
  drizzle.config.ts            # introspection only (see 02 §5)
  Dockerfile.api  Dockerfile.worker  Dockerfile.dev
  src/
    main.ts                    # RUN MODE 1: HTTP server (controllers)
    worker.ts                  # RUN MODE 2: Celery consumer (processors, no HTTP)
    scheduler.ts               # RUN MODE 3: beat (enqueues periodic tasks)
    app.module.ts              # root module (imports infra + feature modules)

    infra/                     # shared, cross-cutting modules
      config/                  # ConfigModule, InstanceConfigService, CryptoService (Fernet)
      database/                # DrizzleModule (DRIZZLE + DRIZZLE_RO providers), schema barrel
      cache/                   # RedisModule (ioredis): locks, throttle store, OTP
      auth/                    # SessionGuard, ApiKeyGuard, AnchorGuard, SessionService, crypto
      rbac/                    # ROLE enum, @Roles decorator, RbacGuard, class perm guards, MemberService
      queue/                   # CeleryProducer, CeleryWorker, TaskHandlerRegistry, CELERY_TASKS
      pagination/              # cursor + grouped/sub-grouped paginators
      serialization/           # FieldsExpandInterceptor + expansion registry + lite DTOs
      storage/                 # S3Service (presign, copy_object)
      mailer/                  # MailerService (SMTP from InstanceConfiguration) + templates
      live-service/            # LiveServiceClient (/convert-document/)
      filters/                 # AllExceptionsFilter (the 4 error envelopes)
      context/                 # RequestContextInterceptor (nestjs-cls: userId, requestId, origin)
      observability/           # OpenTelemetry + pino logger setup

    modules/                   # feature modules (one per domain; see 04)
      user/  workspace/  project/  issue/  cycle/  module/  page/  view/
      intake/  state/  estimate/  label/  notification/  analytics/  search/
      asset/  webhook/  api-token/
      auth/                    # /auth/* endpoints (email, magic, oauth, password, csrf)
      license/                 # /api/instances/* (instance admin, config, telemetry)
      public-api/              # /api/v1/* (API-token surface, mirrors plane/api/views)
      space/                   # /api/public/* (published/anonymous)
      ai/                      # Mastra ai-assistant + unsplash

    shared/                    # pure helpers (no DI): html strip, uuid, date, error codes, constants
  test/                        # e2e + golden-parity tests (see 08 verification)
```

Each feature module typically contains: `*.module.ts`, `*.controller.ts` (one per route group),
`*.service.ts`, `*.repository.ts`, `*.schema.ts` (Drizzle tables for that domain), `dto/`, and
`*.processor.ts` (its background task handlers, if any).

## 3. The three run modes

All three import `AppModule` but bootstrap differently. This matches how `apps/api/bin/*` starts the
Django web/worker/beat processes.

### `main.ts` — HTTP API
```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));                 // pino
  app.use(cookieParser());                         // raw cookies; NOT express-session
  app.set('query parser', 'extended');
  app.enableCors(buildCorsOptions(app.get(ConfigService)));  // includes X-API-Key (see 07)
  app.useGlobalInterceptors(
    app.get(RequestContextInterceptor),            // populate CLS from req.user (see 02 §2a)
    app.get(FieldsExpandInterceptor),              // ?fields / ?expand shaping (see 04 §3)
  );
  app.useGlobalFilters(app.get(AllExceptionsFilter));  // the 4 DRF-compatible error shapes (see 04 §4)
  await app.listen(env.PORT ?? 8000);
}
```
No global auth guard: auth is **per-controller** because the surfaces use different mechanisms
(session vs API key vs anon). Guards are attached at controller/route level (see [`03`](./03-auth-and-rbac.md)).

### `worker.ts` — Celery consumer
```ts
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);  // no HTTP listener
  const worker = app.get(CeleryWorker);
  await worker.start();   // asserts the celery queue(s), consumes, dispatches to TaskHandlers
}
```
Runs the `*.processor.ts` handlers. Scaled horizontally like Celery workers. Consumes only the queues it
owns (per-queue cutover, see [`05`](./05-background-jobs.md) §1).

### `scheduler.ts` — beat
```ts
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.get(BeatScheduler);   // @nestjs/schedule crons fire; each only ENQUEUES a Celery task
}
```
**Single replica** (or Redis-locked) to avoid double-firing, matching Celery beat's singleton nature.

## 4. Request lifecycle (HTTP)

```
Request
  → cookie-parser (raw cookies)
  → [route guards]  SessionGuard | ApiKeyGuard | AnchorGuard   (sets req.user)
  → [route guards]  RbacGuard / class permission guard         (role checks)
  → RequestContextInterceptor    (CLS: userId, origin, requestId)
  → Controller  → Service  → Repository (Drizzle)              (audit/soft-delete/tenancy applied here)
  → (after mutation) enqueue issue_activity + model_activity   (CeleryProducer)
  → FieldsExpandInterceptor      (shape ?fields/?expand)
  → Response  (+ X-RateLimit-* headers for v1)
  → AllExceptionsFilter          (on throw → DRF-compatible envelope)
```

Guard **order matters**: authentication guard first (401 on anonymous), then RBAC (403). This reproduces
DRF, where `IsAuthenticated` runs before object/role permissions.

## 5. Configuration & environment

- `infra/config` wraps `@nestjs/config`. Environment variables are **reused verbatim** from `apps/api`
  (`.env.example`) so a single `.env` can drive both backends during coexistence: `DATABASE_URL` /
  `POSTGRES_*`, `DATABASE_READ_REPLICA_URL`, `REDIS_URL`, `AMQP_URL` / `RABBITMQ_*`, `SECRET_KEY`
  (**must be shared** for session + Fernet parity), `AWS_*` / `USE_MINIO`, `FILE_SIZE_LIMIT`,
  cookie settings (`SESSION_COOKIE_*`, `ADMIN_SESSION_COOKIE_*`), `API_KEY_RATE_LIMIT`, `CORS_ALLOWED_ORIGINS`,
  `LIVE_BASE_URL`/`LIVE_BASE_PATH`, `WEB_URL`/`SPACE_BASE_URL`/`ADMIN_BASE_URL`, `LLM_*`, `UNSPLASH_ACCESS_KEY`,
  `HARD_DELETE_AFTER_DAYS`, `METRICS_PUSH_INTERVAL_MINUTES`, OTEL exporter vars.
- **DB-stored config** (SMTP, OAuth client secrets, LLM keys, Unsplash) lives in the `InstanceConfiguration`
  table and is read via `InstanceConfigService` with the same `SKIP_ENV_VAR` semantics and Fernet
  decryption as Django (see [`06`](./06-ai-mastra.md) §2, [`07`](./07-infra-and-integrations.md) §5).
- A **boot-time schema-version assertion** compares the latest `django_migrations` row against the value the
  Drizzle schema was generated for and logs loudly / refuses to start in non-prod on mismatch
  (see [`02`](./02-data-layer-drizzle.md) §5).

## 6. Monorepo integration

- Add `apps/nestjs-api` as a pnpm workspace member (it is already listed under `apps/` and empty).
  Follow `apps/live`'s `package.json`/`tsconfig.json`/`tsdown|nest build`/`vitest` conventions.
- Add turbo pipeline entries (`build`, `lint`, `test`, `dev`) consistent with the other apps.
- Three Dockerfiles (`api`, `worker`, `dev`) modeled on `apps/api/Dockerfile.api` + `apps/live/Dockerfile.*`.
- The existing `apps/proxy` (nginx/traefik) is the **cutover point**: route prefixes can be shifted from
  Django to NestJS incrementally behind it (see [`08`](./08-implementation-roadmap.md) §cutover).

## 7. Component diagram

```
                         ┌──────────────── apps/proxy ────────────────┐
                         │  routes /api, /api/public, /api/v1, /auth… │
                         └───────┬───────────────────────────┬────────┘
                                 │ (cutover per prefix)       │
                     ┌───────────▼───────────┐    ┌───────────▼───────────┐
                     │  apps/api (Django)     │    │  apps/nestjs-api       │
                     │  web / worker / beat   │    │  main / worker /       │
                     │                        │    │  scheduler             │
                     └───┬─────┬─────┬────┬───┘    └───┬─────┬─────┬────┬───┘
                         │     │     │    │            │     │     │    │
        ┌────────────────▼─┐ ┌─▼───┐ ┌▼──────┐  (shared infrastructure — one of each)
        │   PostgreSQL     │ │Redis│ │RabbitMQ│  ┌────────────┐   ┌──────────────┐
        │  (Django owns    │ │cache│ │ celery │  │  S3/MinIO  │   │  apps/live    │
        │   the schema)    │ │ OTP │ │ queues │  │  (assets)  │   │ /convert-doc  │
        └──────────────────┘ └─────┘ └────────┘  └────────────┘   └──────────────┘
```

Both backends attach to the **same** Postgres, Redis, RabbitMQ, and S3. That shared substrate is exactly
what makes incremental, reversible cutover possible.
