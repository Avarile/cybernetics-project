# NestJS Standalone DB Bootstrap — Design

**Date:** 2026-07-03
**Status:** Revised after Django faithfulness review — pending spec review
**Component:** `apps/nestjs-api`

## Problem

Starting the app shows: _"No authentication methods available / Please contact your
administrator to enable authentication for your instance."_

### Root cause (verified)

- The dev database (`cybernetics_task` @ `localhost:30898`) is **empty — 0 tables**.
- `GET /api/instances/` (`instance.controller.ts:24`) has no `instances` row, so it returns
  `{ is_activated:false, is_setup_done:false }` — **no `config`**.
- Frontend `auth-root.tsx:55`: with `config` undefined, `noAuthMethodsAvailable` is true → the error.

### Why it happened

The NestJS API replaced Django's **runtime API surface** but not its **startup bootstrap**
(`bin/docker-entrypoint-migrator.sh` → `migrate`; `bin/docker-entrypoint-api.sh` →
`register_instance` + `configure_instance`). That bootstrap is the "missed process."

## Decisions (agreed)

1. **NestJS is fully standalone at runtime.** Django (`apps/api`) is kept in-repo **only as a
   reference** — never executed in the NestJS deployment.
2. **Schema (Layer 1)** = generated Drizzle migrations, but **the Drizzle schemas are first
   reconciled to full column parity with Django** (Finding 5). Typed Drizzle stays the single
   source of truth.
3. **Bootstrap runs via `db:init`** (schema + full seed), and the **data seed also runs
   idempotently on every app boot** (register + configure only — mirrors Django's api entrypoint).
4. **`is_setup_done` is satisfied by a headless admin seed** (Finding 1): `db:init` creates the
   first admin `User` + `Profile` + `InstanceAdmin` from env and sets `is_setup_done=true`.

---

## Django faithfulness review — findings

This spec was audited line-by-line against the Django sources. Outcomes:

| #   | Severity        | Finding                                                                                                                                                                                                                                                                                                                                                                                                    | Resolution                                                                  |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | 🔴 Blocker      | `register_instance` leaves `is_setup_done=false`. Once an `instances` row exists, web renders `<InstanceNotReady/>` (`instance-wrapper.tsx:45`) and every auth endpoint rejects with `INSTANCE_NOT_CONFIGURED` (`authentication/views/app/*.py`). `is_setup_done` flips true only in god-mode signup (`admin.py:257`).                                                                                     | **Headless admin seed** (see Layer 3).                                      |
| 2   | 🟠 Accuracy     | The derived `IS_*_ENABLED` block in `configure_instance` (lines 43–152) is **dead code**: `IS_GITEA_ENABLED` is in the config list, so it's created in the main loop, making `filter(key__in=[...]).exists()` true → block skipped. Only `IS_GITEA_ENABLED="0"` is seeded; the other three resolve to `"0"` via read-time env fallback (`instance.py` view + controller both default `"0"`).               | Seeder does **not** implement the derived block.                            |
| 3   | 🟠 Faithfulness | Django `encrypt_data(data)` returns `""` for falsy input (`encryption.py:26`). NestJS `CryptoService.encrypt()` has no guard — `encrypt("")` yields real ciphertext; `encrypt(undefined)` throws.                                                                                                                                                                                                          | Seeder uses `value ? encrypt(value) : ""`.                                  |
| 4   | 🟡 Parity       | `instance_configurations` (Django `BaseModel` = `AuditModel`) has `created_by`, `updated_by`, `deleted_at`; the Drizzle schema omits them, makes `category` nullable, and drops the `unique` on `key`/`instance_id`.                                                                                                                                                                                       | **Auto-resolved by Decision 2** (full-parity reconciliation restores them). |
| 5   | 🔴 Structural   | Drizzle schemas are **deliberately partial subsets** (the `users` schema comment says so). `profiles` and `instance_admins` are **not modeled at all**; `users` omits columns the seed sets (`is_password_autoset`, `last_active`, `last_login_*`, `token_updated_at`, `last_login_medium`, `date_joined`, `display_name`, …). Generating migrations from these would stand up a DB that boots but breaks. | **Full-parity reconciliation** (Layer 1 below).                             |

Confirmed correct: `instance_id = token_hex(12)` (24 hex) · `current_version` fallback chain ·
config-variable list/defaults/encrypted flags · seeded `ENABLE_MAGIC_LINK_LOGIN="0"` wins over the
view's `"1"` default · Fernet key derivation byte-validated in e2e · `GITHUB_APP_NAME`/`SLACK_CLIENT_ID`/`POSTHOG_*`
correctly omitted (env-fallback) · SECRET_KEY precondition covered by `CryptoService` fail-fast.

---

## Scope

**In scope:** reconciling the Drizzle schemas to full Django parity (incl. new `profiles` and
`instance_admins`), generated migrations, and the full data seed (instance + config + headless admin).

**Out of scope (non-goals):** GitHub "latest version" network call (`latest_version = current_version`);
`push_instance_metrics` telemetry; `create_bucket` (S3) and `clear_cache`.

## Architecture

```
npm run db:init  ─┬─► MigrationRunner          (Layer 1: apply generated migrations — full schema)
                  ├─► InstanceBootstrapService  (Layer 2: register + configure)
                  └─► AdminSeedService          (Layer 3: first admin + is_setup_done)  [db:init only]

app boot (main.ts) ─► InstanceBootstrapService  (Layer 2 only, idempotent, every boot)
```

### Layer 1 — Schema (full-parity Drizzle migrations)

Prerequisite reconciliation (one-time, uses Django as reference):

1. Stand up a **Django-migrated reference DB** once (`manage.py migrate` against a scratch DB).
2. `drizzle-kit pull` against it to reconcile all existing schemas to full column parity, and
   **add new schemas for `profiles` and `instance_admins`** plus the missing `users`/`profile`
   columns and the `unique` constraints on `instance_configurations.key` / `instances.instance_id`.
3. `drizzle-kit generate` → baseline migration(s) creating the full schema. **Commit them.**

Runtime: `MigrationRunner` applies committed migrations via drizzle-orm's `migrate()` (tracked in
`__drizzle_migrations`; idempotent, runs once). Django is never executed at runtime.

**Depends on:** `DATABASE_URL`, committed migrations. (Reconciliation depends on a Django-migrated
reference DB — a dev-time step, not a runtime dependency.)

### Layer 2 — InstanceBootstrapService (data seed, mirrors register + configure)

Location `src/infra/database/instance-bootstrap.service.ts`. Injected with `DRIZZLE`,
`CryptoService`, `ConfigService`. Idempotent; safe on every boot. Wrapped in a transaction guarded
by `pg_advisory_xact_lock(<constant>)` for multi-replica safety.

**`registerInstance()`** — mirror of `register_instance.py`:

- If an `instances` row exists → update `last_checked_at`, `current_version`, `latest_version`,
  `is_test`, `edition`. Else insert: `instance_name="Plane Community Edition"`,
  `instance_id = randomBytes(12).toString("hex")`, `current_version` = `APP_VERSION`→package.json→`"v0.1.0"`,
  `latest_version = current_version`, `last_checked_at`/`created_at`/`updated_at` = now,
  `is_test = IS_TEST==="1"`, `edition="PLANE_COMMUNITY"`.
- **Does not** set `is_setup_done` (that's Layer 3), matching Django.

**`configureInstance()`** — mirror of `configure_instance.py` main loop only (no derived block, per
Finding 2):

- Constant `INSTANCE_CONFIG_VARIABLES` mirrors Django's `instance_config_variables` (`core.py`;
  `extended.py` empty) — full 33-key table below.
- Get-or-create by `key`: insert missing rows with `value` (`value ? encrypt(value) : ""` when
  `is_encrypted`, per Finding 3), `category`, `is_encrypted`, and explicit `id=randomUUID()`,
  `created_at`/`updated_at`=now (plus `created_by`/`updated_by`=null, `deleted_at`=null after
  parity reconciliation). Existing rows are left unchanged.

**Depends on:** `SECRET_KEY` (CryptoService fail-fast), an existing schema (Layer 1).

#### `INSTANCE_CONFIG_VARIABLES` (mirror of Django `core.py`)

| key                        | default       | category             | encrypted |
| -------------------------- | ------------- | -------------------- | --------- |
| ENABLE_SIGNUP              | 1             | AUTHENTICATION       | no        |
| **ENABLE_EMAIL_PASSWORD**  | **1**         | AUTHENTICATION       | no        |
| ENABLE_MAGIC_LINK_LOGIN    | 0             | AUTHENTICATION       | no        |
| DISABLE_WORKSPACE_CREATION | 0             | WORKSPACE_MANAGEMENT | no        |
| GOOGLE_CLIENT_ID           | (env)         | GOOGLE               | no        |
| GOOGLE_CLIENT_SECRET       | (env)         | GOOGLE               | **yes**   |
| ENABLE_GOOGLE_SYNC         | 0             | GOOGLE               | no        |
| GITHUB_CLIENT_ID           | (env)         | GITHUB               | no        |
| GITHUB_CLIENT_SECRET       | (env)         | GITHUB               | **yes**   |
| GITHUB_ORGANIZATION_ID     | (env)         | GITHUB               | no        |
| ENABLE_GITHUB_SYNC         | 0             | GITHUB               | no        |
| GITLAB_HOST                | (env)         | GITLAB               | no        |
| GITLAB_CLIENT_ID           | (env)         | GITLAB               | no        |
| GITLAB_CLIENT_SECRET       | (env)         | GITLAB               | **yes**   |
| ENABLE_GITLAB_SYNC         | 0             | GITLAB               | no        |
| IS_GITEA_ENABLED           | 0             | GITEA                | no        |
| GITEA_HOST                 | (env)         | GITEA                | no        |
| GITEA_CLIENT_ID            | (env)         | GITEA                | no        |
| GITEA_CLIENT_SECRET        | (env)         | GITEA                | **yes**   |
| ENABLE_GITEA_SYNC          | 0             | GITEA                | no        |
| ENABLE_SMTP                | 0             | SMTP                 | no        |
| EMAIL_HOST                 | ""            | SMTP                 | no        |
| EMAIL_HOST_USER            | ""            | SMTP                 | no        |
| EMAIL_HOST_PASSWORD        | ""            | SMTP                 | **yes**   |
| EMAIL_PORT                 | 587           | SMTP                 | no        |
| EMAIL_FROM                 | ""            | SMTP                 | no        |
| EMAIL_USE_TLS              | 1             | SMTP                 | no        |
| EMAIL_USE_SSL              | 0             | SMTP                 | no        |
| LLM_API_KEY                | (env)         | AI                   | **yes**   |
| LLM_PROVIDER               | openai        | AI                   | no        |
| LLM_MODEL                  | gpt-4o-mini   | AI                   | no        |
| GPT_ENGINE                 | gpt-3.5-turbo | AI                   | no        |
| UNSPLASH_ACCESS_KEY        | ""            | UNSPLASH             | **yes**   |

`IS_GOOGLE_ENABLED` / `IS_GITHUB_ENABLED` / `IS_GITLAB_ENABLED` are **not** seeded (Finding 2); they
resolve to `"0"` via read-time env fallback. `IS_GITEA_ENABLED="0"` comes from the list above.

### Layer 3 — AdminSeedService (headless first admin + `is_setup_done`) — `db:init` only

Location `src/infra/database/admin-seed.service.ts`. Mirrors god-mode signup (`admin.py:236-260`).
Runs **only in `db:init`**, not on boot. Idempotent via the same advisory lock + guard.

- **Guard (mirror `admin.py:225`):** if `instance.is_setup_done` OR any `instance_admins` row exists → no-op.
- **Env (new, required for `db:init`):** `INSTANCE_ADMIN_EMAIL`, `INSTANCE_ADMIN_PASSWORD`; optional
  `INSTANCE_ADMIN_FIRST_NAME`, `INSTANCE_ADMIN_LAST_NAME`, `INSTANCE_ADMIN_COMPANY`,
  `INSTANCE_ADMIN_TELEMETRY` (default true). Fail fast if email/password missing.
- **Create `User`:** `email`, `username=randomUUID().hex`, `password=makeDjangoPassword(pw)`
  (reuse `infra/auth/django-password.ts`), `first_name`, `last_name`, `is_password_autoset=false`,
  `is_active=true`, `last_active`/`last_login_time`/`token_updated_at`=now, `last_login_medium="email"`.
- **Create `Profile`:** `user_id`, `company_name`, with Django's defaults (`theme={}`,
  `onboarding_step=<default>`, `language="en"`, `billing_address_country="INDIA"`, …). These columns
  exist after Layer 1 parity reconciliation.
- **Create `InstanceAdmin`:** `user_id`, `instance_id`, `role=20`.
- **Update instance:** `is_setup_done=true`, `instance_name=company`, `is_telemetry_enabled`.

**Depends on:** Layers 1 & 2, `SECRET_KEY`, admin env vars, `makeDjangoPassword`.

### CLI entrypoint + boot hook

- `src/db-init.ts`: a headless `NestFactory.createApplicationContext` that runs
  `MigrationRunner.run()` → `InstanceBootstrapService.run()` → `AdminSeedService.run()`, logs, exits.
  Wired to `npm run db:init` (+ dev variant). New scripts: `db:generate`, `db:migrate`, `db:init`.
- `main.ts` (or `DatabaseModule` `OnApplicationBootstrap`): runs **Layer 2 only** before `listen()`,
  gated by `SEED_ON_BOOT` (default `1`). **Not** migrations, **not** admin seed.

## Data flow (fresh deploy)

1. (one-time dev) reconcile schemas to parity from a Django-migrated reference DB → commit migrations.
2. `npm run db:init` → full schema + `instances` row + config + first admin, `is_setup_done=true`.
3. `npm start` → boot re-runs Layer 2 idempotently (no-op under advisory lock).
4. `GET /api/instances/` returns `config.is_email_password_enabled=true` **and** `is_setup_done=true`.
5. Web skips `<InstanceNotReady/>`, renders sign-in; auth endpoints accept. **Login works.**

## Error handling

- `MigrationRunner` and `AdminSeedService`: fail hard (explicit `db:init` steps).
- Seed-on-boot (Layer 2): the instance must exist for the app to work, so failure fails boot fast
  (consistent with `CryptoService`). Advisory lock prevents multi-replica races.
- `db:init` fails fast if `SECRET_KEY` or admin env vars are missing.

## Testing

- **Unit:** `registerInstance`/`configureInstance` idempotency (run 2× → single instance row; each
  key once; `ENABLE_EMAIL_PASSWORD="1"`; encrypted values round-trip; empty encrypted → `""`);
  `IS_GITEA_ENABLED="0"` seeded and no `IS_GOOGLE/GITHUB/GITLAB_ENABLED` rows (Finding 2);
  `AdminSeedService` creates User+Profile+InstanceAdmin, sets `is_setup_done`, and is a no-op on
  re-run and when an admin already exists (Finding 1 guard).
- **e2e:** global setup applies the generated migrations to a fresh `plane_test` DB (replacing manual
  `drizzle-kit push`), runs `db:init`, asserts `GET /api/instances/` returns
  `config.is_email_password_enabled===true` and `instance.is_setup_done===true`, and that a seeded
  admin password verifies via `verifyDjangoPassword`.

## Files to add / change

- Drizzle schemas: reconcile to parity; **add `profiles`, `instance_admins`**; complete `users`/
  `profile` columns; add `unique` on `instance_configurations.key` and `instances.instance_id`.
- `drizzle/…`: committed generated migration(s).
- `package.json`: `db:generate`, `db:migrate`, `db:init`.
- `src/infra/database/migration.runner.ts`
- `src/infra/database/instance-bootstrap.service.ts` + `instance-config.seed.ts`
- `src/infra/database/admin-seed.service.ts`
- `src/db-init.ts`
- `main.ts`: Layer 2 seed on boot behind `SEED_ON_BOOT`.
- `DatabaseModule`: provide the services with `CryptoService`.
- Tests: unit specs for the three services; e2e global setup + instance/admin assertions.
- `.env.example`: `INSTANCE_ADMIN_EMAIL/PASSWORD` (+ optional first/last/company/telemetry), `SEED_ON_BOOT`.
