# 07 — Infrastructure & Integrations

The shared `src/infra/*` modules every feature depends on: database, cache, storage, mail, the live-service
client, config/secrets, CORS, and observability. All attach to the **same** external services as Django so
the two backends coexist.

## 1. Database (`infra/database`)

- **Driver**: `postgres-js` (or `node-postgres`) pool, `drizzle(pool, { schema, casing: 'snake_case' })`.
  Config from `DATABASE_URL` or discrete `POSTGRES_*` (mirroring `dj_database_url`).
- **Providers**: `DRIZZLE` (primary, read/write) and optional `DRIZZLE_RO` (read replica from
  `DATABASE_READ_REPLICA_URL`), exported by a `@Global()` `DrizzleModule`.
- **Read-replica routing**: Django routes non-GET → primary, GET → replica only when a view opts in
  (`use_read_replica=True`). Reproduce as an **explicit choice at the repository/service call site**: read
  methods on opted-in list endpoints use `DRIZZLE_RO`; everything else uses `DRIZZLE`. (No global router
  middleware — explicit is clearer and matches the opt-in nature.)
- **Transactions**: `db.transaction(async tx => …)` for multi-step writes (issue create, comment+description,
  cascade). Advisory locks via `tx.execute(sql\`SELECT pg_advisory_xact_lock(${key})\`)` (see [`02`](./02-data-layer-drizzle.md) §3a).
- **Migrations**: Django owns DDL; Drizzle is DML-only + introspection + CI drift gate (see [`02`](./02-data-layer-drizzle.md) §5).

## 2. Cache / Redis (`infra/cache`)

- **Client**: `ioredis` from `REDIS_URL` (auto-TLS on `rediss://`), matching `django-redis`.
- **Uses**:
  - **Rate-limit stores** — API-key/anon/asset throttles, using the DRF cache-key namespace
    `throttle_<scope>:<ident>` so counters unify if shared with Django (see [`03`](./03-auth-and-rbac.md) §2, §5).
  - **Magic-code OTP** — `magic_<email>` keys with 600s TTL + atomic Lua INCR attempt caps (generate/verify),
    exactly as `provider/credentials/magic_code.py` (see [`03`](./03-auth-and-rbac.md) §4).
  - **Distributed locks** — the beat scheduler singleton lock and `stack_email_notification` batching lock.
  - **Origin / lightweight caches** — small per-request caches Django keeps in Redis.
- Expose a thin `CacheService` (get/set/incr/lock) rather than sprinkling `ioredis` calls.

## 3. Storage / S3 (`infra/storage`)

- **Client**: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Config mirrors `settings/storage.py`
  (`AWS_*`, `USE_MINIO`, endpoint override, `FILE_SIZE_LIMIT` default 5 MB, the `ATTACHMENT_MIME_TYPES`
  allowlist).
- **Operations**: presigned **POST** (client-direct upload, the v2 asset flow), presigned **GET** (download),
  `CopyObjectCommand` (used by the asset-copy task), `HeadObject` (metadata for `get_asset_object_metadata`),
  delete (unuploaded-asset cleanup).
- **`S3Service`** provides `presignUpload(key, contentType, maxSize)`, `presignDownload(key)`,
  `copyObject(src, dst)`, `headObject(key)`, `deleteObject(key)`.
- Asset URL construction matches Django's `FileAsset.asset_url` `@property` → the `/api/assets/v2/…` paths
  (see [`02`](./02-data-layer-drizzle.md) §3c).

## 4. Live-service client (`infra/live-service`)

The only API→live call is `sync_with_external_service` in `bgtasks/copy_s3_object.py`: after duplicating a
page/issue and rewriting asset src ids, it `POST`s to `{LIVE_URL}/convert-document/` with
`{ description_html, variant: "rich" | "document" }` and stores the returned `description_json` +
base64-decoded `description_binary` (the Yjs binary) back on the entity.

```ts
// infra/live-service/live-service.client.ts
@Injectable()
export class LiveServiceClient {
  private base = `${process.env.LIVE_BASE_URL}${process.env.LIVE_BASE_PATH ?? '/live/'}`;
  async convertDocument(descriptionHtml: string, variant: 'rich' | 'document') {
    const resp = await fetch(`${this.base}convert-document/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description_html: descriptionHtml, variant }),
    });
    const { description_json, description_binary } = await resp.json();
    return { descriptionJson: description_json, descriptionBinary: Buffer.from(description_binary, 'base64') };
  }
}
```

Realtime collaboration itself remains owned by `apps/live`; the API is a client only.

## 5. Config & secrets (`infra/config`)

- `ConfigModule` (`@nestjs/config`) for env vars (see [`01`](./01-architecture.md) §5).
- `InstanceConfigService` reads the DB-backed `InstanceConfiguration` store with `SKIP_ENV_VAR` semantics and
  Fernet decryption (see [`06`](./06-ai-mastra.md) §2). Backs LLM keys, **SMTP config**, OAuth client secrets,
  Unsplash, S3 (when stored in DB).
- `CryptoService` — Fernet/PBKDF2 parity with `license/utils/encryption.py`, so encrypted values written by
  Django are readable by NestJS and vice-versa (shared `SECRET_KEY`).
- **Instance bootstrap** — Django's `register_instance` / `configure_instance` management commands seed the
  `Instance` + `InstanceConfiguration` rows. NestJS **reads** these; instance setup can remain a Django
  management concern during coexistence, or be reimplemented as a Nest CLI command later.

## 6. Mailer (`infra/mailer`)

- **Transport**: `nodemailer` SMTP built from `InstanceConfiguration` email config (host/port/user/pass/TLS,
  from-address), via `get_email_configuration` parity. Respects the `disable-email-feature` toggle.
- **Templates**: port the Django `templates/emails/*` (transactional: forgot-password, magic-code,
  activation/deactivation, email-update, project/workspace invites, webhook-deactivation; digest: stacked
  notifications). Use a template engine (e.g. `handlebars`/`mjml`) preserving the same rendered HTML.
- Consumed by the **email/notification processors** ([`05`](./05-background-jobs.md) §3), not controllers.
- `generate_plain_text_from_html` (Django `utils/email.py`) → a small HTML→text helper for multipart mails.

## 7. CORS (`main.ts` + config shim)

From `settings/common.py`: `credentials: true`; use `CORS_ALLOWED_ORIGINS` allowlist or reflect-all fallback;
**allowed headers must include `X-API-Key`** (`[...defaultHeaders, 'X-API-Key']`). `secure_origins`
(true unless any origin is `http:`) drives `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE`. Wire via
`app.enableCors(buildCorsOptions(cfg))`.

## 8. Observability (`infra/observability`)

- **OpenTelemetry** Node SDK with OTLP exporters (grpc/http), mirroring the Django OTEL setup
  (`opentelemetry-*`), incl. the `push_instance_metrics` gauge metrics the license telemetry task pushes.
- **Logging**: `nestjs-pino` producing structured JSON logs comparable to Django's `python-json-logger`
  config, with per-context loggers (`plane.api`, `plane.worker`, `plane.exception`, `plane.authentication`
  equivalents) and request logging (method, path, status, duration_ms, client IP, UA, user_id) — matching
  `middleware/logger.py::RequestLoggerMiddleware` (skip health-check `GET /`).
- **API-activity log** — the `APITokenLogMiddleware` behavior (log X-Api-Key requests to `APIActivityLog`
  via a `process_logs` task, redacting `x-api-key`/`authorization`/`cookie`, storing an HMAC `token_identifier`)
  → a NestJS interceptor on the `public-api` module that enqueues `process_logs`.
- **Request-body-size limit** — reproduce `RequestBodySizeLimitMiddleware` (oversized body → **413**
  `REQUEST_BODY_TOO_LARGE`) via a body-size guard/middleware.
- **APM** — Scout APM is Django-specific; the Node equivalent is OTEL traces (or the org's Node APM). Not a
  wire concern.

## 9. Env var parity (single `.env` for both backends)

Reuse `apps/api/.env.example` verbatim. Critical shared vars: `SECRET_KEY` (**must** match — sessions +
Fernet), `DATABASE_URL`/`POSTGRES_*`, `DATABASE_READ_REPLICA_URL`, `REDIS_URL`, `AMQP_URL`/`RABBITMQ_*`,
`AWS_*`/`USE_MINIO`, `FILE_SIZE_LIMIT`, `SESSION_COOKIE_*`/`ADMIN_SESSION_COOKIE_*`, `API_KEY_RATE_LIMIT`,
`CORS_ALLOWED_ORIGINS`, `LIVE_BASE_URL`/`LIVE_BASE_PATH`, `WEB_URL`/`SPACE_BASE_URL`/`ADMIN_BASE_URL`,
`LLM_*`/`LLM_GATEWAY_URL`, `UNSPLASH_ACCESS_KEY`, `HARD_DELETE_AFTER_DAYS`, `METRICS_PUSH_INTERVAL_MINUTES`,
`ENABLE_*` feature flags (signup/email-password/magic/read-replica/spectacular), OTEL exporter vars.

## 10. Fidelity checklist

- [ ] NestJS reads/writes the same S3 bucket + key layout; presigned upload/download work with existing assets.
- [ ] Magic-OTP TTL/attempt caps and throttle counters behave identically (optionally shared Redis).
- [ ] `LiveServiceClient.convertDocument` returns json + binary and persists them like the Django task.
- [ ] `InstanceConfigService` reads SMTP/OAuth/LLM/Unsplash config (Fernet decryption) written by Django.
- [ ] Emails render byte-similar HTML to the Django templates.
- [ ] CORS allows credentialed requests with `X-API-Key`; oversized bodies → 413.
