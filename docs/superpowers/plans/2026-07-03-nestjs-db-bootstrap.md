# NestJS Standalone DB Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a fresh NestJS deployment stand up its own Postgres schema and seed the instance data (instance row, config, first admin) so the web app renders the sign-in form instead of "No authentication methods available."

**Architecture:** Two milestones. **Milestone A** reconciles the Drizzle schemas to full Django parity and adds generated migrations + a `MigrationRunner` (Layer 1). **Milestone B** adds idempotent seed services mirroring Django's `register_instance` / `configure_instance` / god-mode signup (Layers 2–3), a `db:init` CLI, and a seed-on-boot hook. Django (`apps/api`) is used only as a dev-time reference (schema introspection); it is never run at runtime.

**Tech Stack:** NestJS 10, Drizzle ORM + drizzle-kit 0.31, node-postgres (`pg`), Vitest, Fernet/PBKDF2 utils already in `src/infra/config` and `src/infra/auth`.

**Design spec:** `docs/superpowers/specs/2026-07-03-nestjs-db-bootstrap-design.md`

## Global Constraints

- Keep files under 500 lines; one responsibility per file.
- JS-side defaults: mirror Django's Python field defaults as Drizzle `.default(...)` / `.$defaultFn(...)` (the DB columns carry no default — see `_columns.ts`).
- Idempotency: every seed operation is safe to run repeatedly; wrap seed writes in a transaction guarded by `pg_advisory_xact_lock(4915)` (arbitrary fixed key).
- Encrypted config values use `CryptoService.encrypt`, guarded: `value ? encrypt(value) : ""` (matches Django `encrypt_data`).
- Django-compatible password hashing: reuse `makeDjangoPassword` from `src/infra/auth/django-password.ts`.
- Fail fast: `db:init` throws if `SECRET_KEY`, `INSTANCE_ADMIN_EMAIL`, or `INSTANCE_ADMIN_PASSWORD` are missing.
- Do NOT implement the dead `IS_*_ENABLED` derived block from `configure_instance.py` (Finding 2); only seed `IS_GITEA_ENABLED` (via the config list).
- Commits: this repo does NOT use a `Co-Authored-By` trailer.

## Environment (execution — resolved in pre-flight)

- **Reference schema (READ-ONLY):** an already-migrated Plane database `plane` on `localhost:30898`
  (263 tables). Introspect/pull only — **never write to it.** No Django is needed or installed.
- **Test/build DB (disposable):** `plane_test` on `localhost:30898` (already created).
- **Credentials & env:** source `"$SCRATCH/db-env.sh"` (kept out of git) which exports `REF_DB_URL`,
  `TEST_DB_URL`, `DATABASE_URL=$TEST_DB_URL`, `SECRET_KEY`, `SEED_ON_BOOT=0`, and the
  `INSTANCE_ADMIN_*` vars. Where a step shows a literal `postgresql://…5432…` URL, use `$TEST_DB_URL`
  / `$REF_DB_URL` instead — the `:30898` server is the only reachable Postgres.
- **Parity scope decision:** bring the **~37 tables the NestJS app models** to full _column_ parity
  against the reference; **skip (and `log`) the 226 reference tables the app never queries.** Do not
  generate migrations for unused tables. If `drizzle-kit generate` errors because a modeled table's
  FK targets a table outside the set, **add that referenced table's schema** (pull its columns from
  the reference) — do not drop the FK.
- **Execution order (adjusted):** A2 → A3 → A1 → B1 → B2 → B3 → B4. (A1's `MigrationRunner` test
  needs committed migrations, which A2/A3 produce.)

---

## Milestone A — Schema parity + migration infrastructure

### Task A1: MigrationRunner (runtime migration application)

> **Execution order:** run this AFTER A2 and A3 — the `db:generate`/`db:migrate`/`db:init` scripts are
> added in A2 Step 0, and the committed migrations this test applies are produced by A2/A3.

**Files:**

- Create: `apps/nestjs-api/src/infra/database/migration.runner.ts`
- Test: `apps/nestjs-api/test/migration-runner.e2e.spec.ts`

**Interfaces:**

- Produces: `class MigrationRunner { constructor(pool: Pool); run(migrationsFolder?: string): Promise<void> }`

- [ ] **Step 1: Confirm the drizzle-kit scripts exist**

`db:generate`, `db:migrate`, `db:init` were added in A2 Step 0. Verify: `grep db:migrate apps/nestjs-api/package.json`. If absent, add them per A2 Step 0.

- [ ] **Step 2: Write the failing test**

```typescript
// apps/nestjs-api/test/migration-runner.e2e.spec.ts
import { Pool } from "pg";
import { MigrationRunner } from "../src/infra/database/migration.runner";

describe("MigrationRunner", () => {
  it("applies committed migrations and records them in __drizzle_migrations", async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const runner = new MigrationRunner(pool);
    await runner.run();
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
    expect(rows[0].n).toBeGreaterThan(0);
    await pool.end();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/nestjs-api && npm run test:e2e -- migration-runner`
Expected: FAIL — `Cannot find module '.../migration.runner'`.

- [ ] **Step 4: Implement MigrationRunner**

```typescript
// apps/nestjs-api/src/infra/database/migration.runner.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { join } from "path";

/** Applies committed Drizzle migrations. Idempotent: drizzle tracks applied migrations. */
export class MigrationRunner {
  constructor(private readonly pool: Pool) {}

  async run(migrationsFolder = join(__dirname, "../../../drizzle")): Promise<void> {
    const db = drizzle(this.pool);
    await migrate(db, { migrationsFolder });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/nestjs-api && npm run test:e2e -- migration-runner`
Expected: PASS. (Requires Task A2/A3 migrations committed; if run before them, at least one baseline migration must exist — sequence A2/A3 first if empty.)

- [ ] **Step 6: Commit**

```bash
git add apps/nestjs-api/package.json apps/nestjs-api/src/infra/database/migration.runner.ts apps/nestjs-api/test/migration-runner.e2e.spec.ts
git commit -m "feat(nestjs-api): add MigrationRunner + drizzle-kit generate/migrate scripts"
```

---

### Task A2: Reconcile existing schemas to full Django parity (from a reference DB)

This task is mechanical (introspection-driven), not TDD. Its deliverable is verified by a parity check, not a unit test.

**Files:**

- Modify: `apps/nestjs-api/src/**/*.schema.ts` (add missing columns)
- Create: `apps/nestjs-api/scripts/schema-parity-check.ts`
- Create: `apps/nestjs-api/drizzle/0000_*.sql` (generated)

**Interfaces:**

- Produces: a committed baseline migration that creates every Django table/column the app uses.

- [ ] **Step 0: Add drizzle-kit scripts to package.json**

In `apps/nestjs-api/package.json` `scripts`, add alongside `db:push`/`db:pull`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:init": "node dist/db-init.js"
```

- [ ] **Step 1: Use the existing migrated reference DB (no Django)**

The reference is the already-migrated `plane` DB on `:30898` — no `manage.py migrate` needed.

```bash
source "$SCRATCH/db-env.sh"   # exports REF_DB_URL (plane), TEST_DB_URL (plane_test), DATABASE_URL
psql "$REF_DB_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
```

Expected: 263 (the full migrated schema). This DB is READ-ONLY — introspect only.

- [ ] **Step 2: Introspect the reference schema into a comparison-only file**

```bash
cd apps/nestjs-api
DATABASE_URL="$REF_DB_URL" npx drizzle-kit pull --out ./drizzle/_reference
```

Expected: `./drizzle/_reference/schema.ts` lists every table/column. Treat it as the column source of
truth for the ~37 modeled tables only (it will NOT contain Django's Python-level defaults — add those
as `.default`/`.$defaultFn` when reconciling, per Global Constraints). Do NOT import `_reference` into
the app or generate migrations for the 226 unused tables; it is a diff aid. `log` the skipped tables.

- [ ] **Step 3: Add missing columns to the 35 existing module schemas**

For each `*.schema.ts`, compare against `_reference/schema.ts` and add any missing columns with the correct type and a JS default mirroring Django. Focus especially on `users` (see the concrete additions in Task A3, Step 1). Do NOT delete the hand-authored JS defaults already present.

- [ ] **Step 4: Write the parity-check script**

```typescript
// apps/nestjs-api/scripts/schema-parity-check.ts
import { Pool } from "pg";

// Column-parity check restricted to the MODELED tables. The migrated DB
// (DATABASE_URL = plane_test) contains only the ~37 tables we generate, so we
// use its table list as the modeled set and assert every reference (PGREF)
// column for those tables is present. Reference tables absent from plane_test
// are the intentionally-skipped 226 and are logged, not failed.
async function tables(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'`
  );
  return rows.map((r) => r.table_name);
}
async function cols(pool: Pool, table: string): Promise<Set<string>> {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return new Set(rows.map((r) => r.column_name));
}

async function main() {
  const ref = new Pool({ connectionString: process.env.PGREF });
  const got = new Pool({ connectionString: process.env.DATABASE_URL });
  const modeled = await tables(got);
  const refAll = new Set(await tables(ref));
  const skipped = [...refAll].filter((t) => !modeled.includes(t));
  const missing: string[] = [];
  for (const t of modeled) {
    if (!refAll.has(t)) {
      console.error(`modeled table not in reference: ${t}`);
      process.exit(1);
    }
    const refCols = await cols(ref, t);
    const gotCols = await cols(got, t);
    for (const c of refCols) if (!gotCols.has(c)) missing.push(`${t}.${c}`);
  }
  await ref.end();
  await got.end();
  console.log(`skipped ${skipped.length} unused reference tables (not generated).`);
  if (missing.length) {
    console.error(`Missing ${missing.length} columns:\n` + missing.sort().join("\n"));
    process.exit(1);
  }
  console.log(`OK: all reference columns present for ${modeled.length} modeled tables.`);
}
main();
```

- [ ] **Step 5: Generate the baseline migration and verify parity**

```bash
source "$SCRATCH/db-env.sh"
cd apps/nestjs-api
npm run db:generate                      # writes drizzle/0000_*.sql from the reconciled schema
# reset the disposable test DB so parity is measured on a clean apply
psql "$REF_DB_URL" -c "" >/dev/null; psql "${TEST_DB_URL%/*}/postgres" -c "DROP DATABASE IF EXISTS plane_test; CREATE DATABASE plane_test;"
DATABASE_URL="$TEST_DB_URL" npm run db:migrate
PGREF="$REF_DB_URL" DATABASE_URL="$TEST_DB_URL" npx tsx scripts/schema-parity-check.ts
```

The parity-check script (Step 4) must compare only the ~37 modeled tables: derive the modeled set from
the app's `pgTable(...)` names and restrict the reference column set to those tables; `console.log` the
skipped table count. Expected: `OK: all N reference columns present.` for the modeled tables.

- [ ] **Step 6: Commit**

```bash
git add apps/nestjs-api/src apps/nestjs-api/drizzle apps/nestjs-api/scripts/schema-parity-check.ts
git commit -m "feat(nestjs-api): reconcile Drizzle schemas to full Django parity + baseline migration"
```

---

### Task A3: Add `profiles` + `instance_admins` schemas and complete `users`

**Files:**

- Modify: `apps/nestjs-api/src/infra/database/schema/user.schema.ts`
- Create: `apps/nestjs-api/src/modules/profile/profile.schema.ts`
- Create: `apps/nestjs-api/src/modules/instance/instance-admin.schema.ts`
- Modify: `apps/nestjs-api/src/infra/database/schema/index.ts` (export new schemas)
- Modify: `apps/nestjs-api/src/infra/database/schema/instance.schema.ts` (unique on `instanceId`)

**Interfaces:**

- Produces: `profiles`, `instanceAdmins` Drizzle tables; extended `users` columns; `instanceConfigurations.key` + `instances.instanceId` unique.

- [ ] **Step 1: Add missing `users` columns the admin seed sets**

In `user.schema.ts`, add inside the `pgTable("users", { ... })` object:

```typescript
  isPasswordAutoset: boolean("is_password_autoset").notNull().default(false),
  isEmailVerified: boolean("is_email_verified").notNull().default(false),
  dateJoined: timestamp("date_joined", { withTimezone: true, mode: "date" })
    .$defaultFn(() => new Date()).notNull(),
  lastActive: timestamp("last_active", { withTimezone: true, mode: "date" }),
  lastLoginTime: timestamp("last_login_time", { withTimezone: true, mode: "date" }),
  lastLoginIp: varchar("last_login_ip", { length: 255 }).notNull().default(""),
  lastLoginMedium: varchar("last_login_medium", { length: 20 }).notNull().default("email"),
  lastLoginUagent: text("last_login_uagent").notNull().default(""),
  tokenUpdatedAt: timestamp("token_updated_at", { withTimezone: true, mode: "date" }),
```

(Add `text` to the drizzle-orm import if not present.)

- [ ] **Step 2: Create the `instance_admins` schema**

```typescript
// apps/nestjs-api/src/modules/instance/instance-admin.schema.ts
import { integer, pgTable, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "../../infra/database/schema/_columns";

// db_table = "instance_admins" (plane/license/models/instance.py). role default 20 (Admin).
export const instanceAdmins = pgTable("instance_admins", {
  ...baseColumns,
  userId: uuid("user_id"),
  instanceId: uuid("instance_id").notNull(),
  role: integer("role").notNull().default(20),
});

export type InstanceAdmin = typeof instanceAdmins.$inferSelect;
```

- [ ] **Step 3: Create the `profiles` schema (defaults mirror Django)**

```typescript
// apps/nestjs-api/src/modules/profile/profile.schema.ts
import { boolean, integer, jsonb, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "../../infra/database/schema/_columns";

const onboarding = () => ({
  profile_complete: false,
  workspace_create: false,
  workspace_invite: false,
  workspace_join: false,
});
const mobileOnboarding = () => ({ profile_complete: false, workspace_create: false, workspace_join: false });
const productTour = () => ({ work_items: false, cycles: false, modules: false, intake: false, pages: false });

// db_table = "profiles" (plane/db/models/user.py::Profile). One row per user.
export const profiles = pgTable("profiles", {
  ...baseColumns,
  userId: uuid("user_id").notNull().unique(),
  theme: jsonb("theme")
    .$defaultFn(() => ({}))
    .notNull(),
  isAppRailDocked: boolean("is_app_rail_docked").notNull().default(true),
  isTourCompleted: boolean("is_tour_completed").notNull().default(false),
  onboardingStep: jsonb("onboarding_step").$defaultFn(onboarding).notNull(),
  useCase: text("use_case"),
  role: varchar("role", { length: 300 }),
  isOnboarded: boolean("is_onboarded").notNull().default(false),
  lastWorkspaceId: uuid("last_workspace_id"),
  billingAddressCountry: varchar("billing_address_country", { length: 255 }).notNull().default("INDIA"),
  billingAddress: jsonb("billing_address"),
  hasBillingAddress: boolean("has_billing_address").notNull().default(false),
  companyName: varchar("company_name", { length: 255 }).notNull().default(""),
  notificationViewMode: varchar("notification_view_mode", { length: 255 }).notNull().default("full"),
  isSmoothCursorEnabled: boolean("is_smooth_cursor_enabled").notNull().default(false),
  isMobileOnboarded: boolean("is_mobile_onboarded").notNull().default(false),
  mobileOnboardingStep: jsonb("mobile_onboarding_step").$defaultFn(mobileOnboarding).notNull(),
  mobileTimezoneAutoSet: boolean("mobile_timezone_auto_set").notNull().default(false),
  language: varchar("language", { length: 255 }).notNull().default("en"),
  startOfTheWeek: integer("start_of_the_week").notNull().default(0),
  goals: jsonb("goals")
    .$defaultFn(() => ({}))
    .notNull(),
  backgroundColor: varchar("background_color", { length: 255 }).notNull().default("#3f76ff"),
  isNavigationTourCompleted: boolean("is_navigation_tour_completed").notNull().default(false),
  hasMarketingEmailConsent: boolean("has_marketing_email_consent").notNull().default(false),
  isSubscribedToChangelog: boolean("is_subscribed_to_changelog").notNull().default(false),
  productTour: jsonb("product_tour").$defaultFn(productTour).notNull(),
});

export type Profile = typeof profiles.$inferSelect;
```

- [ ] **Step 4: Export the new schemas and add unique constraints**

In `src/infra/database/schema/index.ts` add:

```typescript
export * from "../../../modules/profile/profile.schema";
export * from "../../../modules/instance/instance-admin.schema";
```

In `instance.schema.ts`, add `.unique()` to `instanceId` and to `instanceConfigurations.key`:

```typescript
  instanceId: varchar("instance_id", { length: 255 }).notNull().unique(),
  // ...
  key: varchar("key", { length: 100 }).notNull().unique(),
```

- [ ] **Step 5: Regenerate migration and re-verify parity**

Run: `cd apps/nestjs-api && npm run db:generate && DATABASE_URL="postgresql://plane:plane@localhost:5432/plane_test" npm run db:migrate`
Then re-run the parity check from Task A2 Step 5.
Expected: `profiles`, `instance_admins` present; parity OK.

- [ ] **Step 6: Commit**

```bash
git add apps/nestjs-api/src apps/nestjs-api/drizzle
git commit -m "feat(nestjs-api): add profiles + instance_admins schemas, complete users columns"
```

---

## Milestone B — Data bootstrap (register + configure + admin) + CLI

### Task B1: Config-variable constant + InstanceBootstrapService

**Files:**

- Create: `apps/nestjs-api/src/infra/database/instance-config.seed.ts`
- Create: `apps/nestjs-api/src/infra/database/instance-bootstrap.service.ts`
- Test: `apps/nestjs-api/test/instance-bootstrap.e2e.spec.ts`

**Interfaces:**

- Consumes: `DRIZZLE`, `CryptoService`, `ConfigService`.
- Produces: `class InstanceBootstrapService { registerInstance(): Promise<void>; configureInstance(): Promise<void>; run(): Promise<void> }`; `INSTANCE_CONFIG_VARIABLES: { key: string; value: string | undefined; category: string; isEncrypted: boolean }[]`.

- [ ] **Step 1: Write the config-variable constant**

```typescript
// apps/nestjs-api/src/infra/database/instance-config.seed.ts
export interface ConfigVar {
  key: string;
  value: string | undefined;
  category: string;
  isEncrypted: boolean;
}

const env = (k: string, d?: string) => process.env[k] ?? d;

// Mirror of plane/utils/instance_config_variables/core.py (extended.py is empty).
export const INSTANCE_CONFIG_VARIABLES: ConfigVar[] = [
  { key: "ENABLE_SIGNUP", value: env("ENABLE_SIGNUP", "1"), category: "AUTHENTICATION", isEncrypted: false },
  {
    key: "ENABLE_EMAIL_PASSWORD",
    value: env("ENABLE_EMAIL_PASSWORD", "1"),
    category: "AUTHENTICATION",
    isEncrypted: false,
  },
  {
    key: "ENABLE_MAGIC_LINK_LOGIN",
    value: env("ENABLE_MAGIC_LINK_LOGIN", "0"),
    category: "AUTHENTICATION",
    isEncrypted: false,
  },
  {
    key: "DISABLE_WORKSPACE_CREATION",
    value: env("DISABLE_WORKSPACE_CREATION", "0"),
    category: "WORKSPACE_MANAGEMENT",
    isEncrypted: false,
  },
  { key: "GOOGLE_CLIENT_ID", value: env("GOOGLE_CLIENT_ID"), category: "GOOGLE", isEncrypted: false },
  { key: "GOOGLE_CLIENT_SECRET", value: env("GOOGLE_CLIENT_SECRET"), category: "GOOGLE", isEncrypted: true },
  { key: "ENABLE_GOOGLE_SYNC", value: env("ENABLE_GOOGLE_SYNC", "0"), category: "GOOGLE", isEncrypted: false },
  { key: "GITHUB_CLIENT_ID", value: env("GITHUB_CLIENT_ID"), category: "GITHUB", isEncrypted: false },
  { key: "GITHUB_CLIENT_SECRET", value: env("GITHUB_CLIENT_SECRET"), category: "GITHUB", isEncrypted: true },
  { key: "GITHUB_ORGANIZATION_ID", value: env("GITHUB_ORGANIZATION_ID"), category: "GITHUB", isEncrypted: false },
  { key: "ENABLE_GITHUB_SYNC", value: env("ENABLE_GITHUB_SYNC", "0"), category: "GITHUB", isEncrypted: false },
  { key: "GITLAB_HOST", value: env("GITLAB_HOST"), category: "GITLAB", isEncrypted: false },
  { key: "GITLAB_CLIENT_ID", value: env("GITLAB_CLIENT_ID"), category: "GITLAB", isEncrypted: false },
  { key: "GITLAB_CLIENT_SECRET", value: env("GITLAB_CLIENT_SECRET"), category: "GITLAB", isEncrypted: true },
  { key: "ENABLE_GITLAB_SYNC", value: env("ENABLE_GITLAB_SYNC", "0"), category: "GITLAB", isEncrypted: false },
  { key: "IS_GITEA_ENABLED", value: env("IS_GITEA_ENABLED", "0"), category: "GITEA", isEncrypted: false },
  { key: "GITEA_HOST", value: env("GITEA_HOST"), category: "GITEA", isEncrypted: false },
  { key: "GITEA_CLIENT_ID", value: env("GITEA_CLIENT_ID"), category: "GITEA", isEncrypted: false },
  { key: "GITEA_CLIENT_SECRET", value: env("GITEA_CLIENT_SECRET"), category: "GITEA", isEncrypted: true },
  { key: "ENABLE_GITEA_SYNC", value: env("ENABLE_GITEA_SYNC", "0"), category: "GITEA", isEncrypted: false },
  { key: "ENABLE_SMTP", value: env("ENABLE_SMTP", "0"), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_HOST", value: env("EMAIL_HOST", ""), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_HOST_USER", value: env("EMAIL_HOST_USER", ""), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_HOST_PASSWORD", value: env("EMAIL_HOST_PASSWORD", ""), category: "SMTP", isEncrypted: true },
  { key: "EMAIL_PORT", value: env("EMAIL_PORT", "587"), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_FROM", value: env("EMAIL_FROM", ""), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_USE_TLS", value: env("EMAIL_USE_TLS", "1"), category: "SMTP", isEncrypted: false },
  { key: "EMAIL_USE_SSL", value: env("EMAIL_USE_SSL", "0"), category: "SMTP", isEncrypted: false },
  { key: "LLM_API_KEY", value: env("LLM_API_KEY"), category: "AI", isEncrypted: true },
  { key: "LLM_PROVIDER", value: env("LLM_PROVIDER", "openai"), category: "AI", isEncrypted: false },
  { key: "LLM_MODEL", value: env("LLM_MODEL", "gpt-4o-mini"), category: "AI", isEncrypted: false },
  { key: "GPT_ENGINE", value: env("GPT_ENGINE", "gpt-3.5-turbo"), category: "AI", isEncrypted: false },
  { key: "UNSPLASH_ACCESS_KEY", value: env("UNSPLASH_ACCESS_KEY", ""), category: "UNSPLASH", isEncrypted: true },
];
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/nestjs-api/test/instance-bootstrap.e2e.spec.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "../src/infra/database/schema";
import { CryptoService } from "../src/infra/config/crypto.service";
import { ConfigService } from "../src/infra/config/config.service";
import { InstanceBootstrapService } from "../src/infra/database/instance-bootstrap.service";

describe("InstanceBootstrapService", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  const cfg = new ConfigService();
  const crypto = new CryptoService(cfg);
  crypto.onModuleInit();
  const svc = new InstanceBootstrapService(db as any, crypto, cfg);

  beforeAll(async () => {
    await pool.query("DELETE FROM instance_configurations");
    await pool.query("DELETE FROM instances");
  });
  afterAll(() => pool.end());

  it("is idempotent: one instance row, one row per key, email/password on", async () => {
    await svc.run();
    await svc.run();
    const inst = await pool.query("SELECT count(*)::int n FROM instances");
    expect(inst.rows[0].n).toBe(1);
    const dup = await pool.query(
      "SELECT key, count(*)::int n FROM instance_configurations GROUP BY key HAVING count(*)>1"
    );
    expect(dup.rowCount).toBe(0);
    const ep = await pool.query("SELECT value FROM instance_configurations WHERE key='ENABLE_EMAIL_PASSWORD'");
    expect(ep.rows[0].value).toBe("1");
    // encrypted empty -> "" (Finding 3); no IS_GOOGLE_ENABLED row (Finding 2)
    const g = await pool.query("SELECT count(*)::int n FROM instance_configurations WHERE key='IS_GOOGLE_ENABLED'");
    expect(g.rows[0].n).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/nestjs-api && npm run test:e2e -- instance-bootstrap`
Expected: FAIL — cannot find `InstanceBootstrapService`.

- [ ] **Step 4: Implement InstanceBootstrapService**

```typescript
// apps/nestjs-api/src/infra/database/instance-bootstrap.service.ts
import { randomBytes, randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "./drizzle.module";
import { instances, instanceConfigurations } from "./schema";
import { CryptoService } from "../config/crypto.service";
import { ConfigService } from "../config/config.service";
import { INSTANCE_CONFIG_VARIABLES } from "./instance-config.seed";

const ADVISORY_LOCK = 4915;

@Injectable()
export class InstanceBootstrapService {
  private readonly log = new Logger(InstanceBootstrapService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService
  ) {}

  private currentVersion(): string {
    const fromEnv = this.config.get<string>("APP_VERSION");
    if (fromEnv) return fromEnv;
    try {
      const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
      return pkg.version ?? "v0.1.0";
    } catch {
      return "v0.1.0";
    }
  }

  async registerInstance(): Promise<void> {
    const [existing] = await this.db.select().from(instances).limit(1);
    const now = new Date();
    const version = this.currentVersion();
    const isTest = this.config.get<string>("IS_TEST") === "1";
    if (existing) {
      await this.db.update(instances).set({
        lastCheckedAt: now,
        currentVersion: version,
        latestVersion: version,
        isTest,
        edition: "PLANE_COMMUNITY",
      });
      return;
    }
    await this.db.insert(instances).values({
      instanceName: "Plane Community Edition",
      instanceId: randomBytes(12).toString("hex"),
      currentVersion: version,
      latestVersion: version,
      lastCheckedAt: now,
      isTest,
      edition: "PLANE_COMMUNITY",
    });
  }

  async configureInstance(): Promise<void> {
    const now = new Date();
    for (const v of INSTANCE_CONFIG_VARIABLES) {
      const [row] = await this.db
        .select()
        .from(instanceConfigurations)
        .where(sql`${instanceConfigurations.key} = ${v.key}`)
        .limit(1);
      if (row) continue; // get-or-create: leave existing rows untouched
      const stored = v.isEncrypted ? (v.value ? this.crypto.encrypt(v.value) : "") : (v.value ?? null);
      await this.db.insert(instanceConfigurations).values({
        id: randomUUID(),
        key: v.key,
        value: stored,
        category: v.category,
        isEncrypted: v.isEncrypted,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async run(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK})`);
      await this.registerInstance();
      await this.configureInstance();
    });
    this.log.log("instance registered + configured");
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/nestjs-api && npm run test:e2e -- instance-bootstrap`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/nestjs-api/src/infra/database/instance-config.seed.ts apps/nestjs-api/src/infra/database/instance-bootstrap.service.ts apps/nestjs-api/test/instance-bootstrap.e2e.spec.ts
git commit -m "feat(nestjs-api): InstanceBootstrapService (register + configure)"
```

---

### Task B2: AdminSeedService (headless first admin + is_setup_done)

**Files:**

- Create: `apps/nestjs-api/src/infra/database/admin-seed.service.ts`
- Test: `apps/nestjs-api/test/admin-seed.e2e.spec.ts`

**Interfaces:**

- Consumes: `DRIZZLE`, `ConfigService`, `makeDjangoPassword`, `verifyDjangoPassword`, `instances`, `users`, `profiles`, `instanceAdmins`.
- Produces: `class AdminSeedService { run(): Promise<void> }`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/nestjs-api/test/admin-seed.e2e.spec.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/infra/database/schema";
import { ConfigService } from "../src/infra/config/config.service";
import { AdminSeedService } from "../src/infra/database/admin-seed.service";
import { InstanceBootstrapService } from "../src/infra/database/instance-bootstrap.service";
import { CryptoService } from "../src/infra/config/crypto.service";
import { verifyDjangoPassword } from "../src/infra/auth/django-password";

describe("AdminSeedService", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  const cfg = new ConfigService();
  const crypto = new CryptoService(cfg);
  crypto.onModuleInit();

  beforeAll(async () => {
    process.env.INSTANCE_ADMIN_EMAIL = "admin@example.com";
    process.env.INSTANCE_ADMIN_PASSWORD = "Sup3rSecret!";
    await pool.query("DELETE FROM instance_admins");
    await pool.query("DELETE FROM profiles");
    await pool.query("DELETE FROM users WHERE email='admin@example.com'");
    await pool.query("DELETE FROM instances");
    await new InstanceBootstrapService(db as any, crypto, cfg).run();
  });
  afterAll(() => pool.end());

  it("creates user+profile+admin, sets is_setup_done, hashes Django-compatibly, idempotent", async () => {
    const svc = new AdminSeedService(db as any, cfg);
    await svc.run();
    await svc.run(); // second run is a no-op (admin exists)
    const u = await pool.query("SELECT password FROM users WHERE email='admin@example.com'");
    expect(u.rowCount).toBe(1);
    expect(verifyDjangoPassword("Sup3rSecret!", u.rows[0].password)).toBe(true);
    const p = await pool.query("SELECT count(*)::int n FROM profiles");
    expect(p.rows[0].n).toBe(1);
    const a = await pool.query("SELECT count(*)::int n FROM instance_admins");
    expect(a.rows[0].n).toBe(1);
    const inst = await pool.query("SELECT is_setup_done FROM instances");
    expect(inst.rows[0].is_setup_done).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/nestjs-api && npm run test:e2e -- admin-seed`
Expected: FAIL — cannot find `AdminSeedService`.

- [ ] **Step 3: Implement AdminSeedService**

```typescript
// apps/nestjs-api/src/infra/database/admin-seed.service.ts
import { randomUUID } from "crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "./drizzle.module";
import { instances, users, profiles, instanceAdmins } from "./schema";
import { ConfigService } from "../config/config.service";
import { makeDjangoPassword } from "../auth/django-password";

const ADVISORY_LOCK = 4915;

@Injectable()
export class AdminSeedService {
  private readonly log = new Logger(AdminSeedService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService
  ) {}

  async run(): Promise<void> {
    const email = this.config.get<string>("INSTANCE_ADMIN_EMAIL");
    const password = this.config.get<string>("INSTANCE_ADMIN_PASSWORD");
    if (!email || !password) {
      throw new Error("INSTANCE_ADMIN_EMAIL and INSTANCE_ADMIN_PASSWORD are required for db:init");
    }
    const firstName = this.config.get<string>("INSTANCE_ADMIN_FIRST_NAME") ?? "";
    const lastName = this.config.get<string>("INSTANCE_ADMIN_LAST_NAME") ?? "";
    const company = this.config.get<string>("INSTANCE_ADMIN_COMPANY") ?? "Plane Community Edition";
    const telemetry = this.config.get<string>("INSTANCE_ADMIN_TELEMETRY") !== "0";

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK})`);
      const [instance] = await tx.select().from(instances).limit(1);
      if (!instance) throw new Error("No instance row; run InstanceBootstrapService first");

      const [admin] = await tx.select().from(instanceAdmins).limit(1);
      if (instance.isSetupDone || admin) {
        this.log.log("instance admin already exists; skipping");
        return;
      }

      const now = new Date();
      const userId = randomUUID();
      await tx.insert(users).values({
        id: userId,
        email,
        username: randomUUID().replace(/-/g, ""),
        password: makeDjangoPassword(password),
        firstName,
        lastName,
        isPasswordAutoset: false,
        isActive: true,
        lastActive: now,
        lastLoginTime: now,
        lastLoginMedium: "email",
        tokenUpdatedAt: now,
        dateJoined: now,
        createdAt: now,
        updatedAt: now,
      });
      await tx
        .insert(profiles)
        .values({ id: randomUUID(), userId, companyName: company, createdAt: now, updatedAt: now });
      await tx.insert(instanceAdmins).values({
        id: randomUUID(),
        userId,
        instanceId: instance.id as string,
        role: 20,
        createdAt: now,
        updatedAt: now,
      });
      await tx.update(instances).set({ isSetupDone: true, instanceName: company, isTelemetryEnabled: telemetry });
    });
    this.log.log("instance admin seeded; is_setup_done=true");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/nestjs-api && npm run test:e2e -- admin-seed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/nestjs-api/src/infra/database/admin-seed.service.ts apps/nestjs-api/test/admin-seed.e2e.spec.ts
git commit -m "feat(nestjs-api): AdminSeedService (headless first admin + is_setup_done)"
```

---

### Task B3: `db:init` CLI entrypoint + seed-on-boot hook

**Files:**

- Create: `apps/nestjs-api/src/db-init.ts`
- Modify: `apps/nestjs-api/src/infra/database/drizzle.module.ts` (provide the two services)
- Modify: `apps/nestjs-api/src/main.ts` (seed on boot behind `SEED_ON_BOOT`)
- Modify: `apps/nestjs-api/.env.example`

**Interfaces:**

- Consumes: `MigrationRunner`, `InstanceBootstrapService`, `AdminSeedService`, `AppModule`.

- [ ] **Step 1: Register the services in the module**

In `drizzle.module.ts`, add `InstanceBootstrapService` and `AdminSeedService` to `providers` and `exports` (they resolve `DRIZZLE`, `CryptoService`, `ConfigService` — ensure `CryptoService`/`ConfigService` are importable; the module is `@Global`).

- [ ] **Step 2: Write the db-init CLI**

```typescript
// apps/nestjs-api/src/db-init.ts
import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import { AppModule } from "./app.module";
import { MigrationRunner } from "./infra/database/migration.runner";
import { InstanceBootstrapService } from "./infra/database/instance-bootstrap.service";
import { AdminSeedService } from "./infra/database/admin-seed.service";

async function main(): Promise<void> {
  const log = new Logger("db-init");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await new MigrationRunner(pool).run();
  await pool.end();
  log.log("migrations applied");

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["log", "warn", "error"] });
  try {
    await app.get(InstanceBootstrapService).run();
    await app.get(AdminSeedService).run();
    log.log("db:init complete");
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  new Logger("db-init").error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Add the seed-on-boot hook in main.ts**

In `main.ts` `bootstrap()`, after the app is created and before `listen`, add:

```typescript
if (process.env.SEED_ON_BOOT !== "0") {
  await app.get(InstanceBootstrapService).run();
}
```

(Import `InstanceBootstrapService`. Migrations and admin seed are NOT run on boot.)

- [ ] **Step 4: Document env vars**

Append to `.env.example`:

```
# DB bootstrap
SEED_ON_BOOT=1
INSTANCE_ADMIN_EMAIL=
INSTANCE_ADMIN_PASSWORD=
INSTANCE_ADMIN_FIRST_NAME=
INSTANCE_ADMIN_LAST_NAME=
INSTANCE_ADMIN_COMPANY=Plane Community Edition
INSTANCE_ADMIN_TELEMETRY=1
```

- [ ] **Step 5: Build and smoke-test db:init against a fresh DB**

```bash
cd apps/nestjs-api
createdb -h localhost -U plane plane_init 2>/dev/null || true
export DATABASE_URL="postgresql://plane:plane@localhost:5432/plane_init"
export SECRET_KEY=dev-secret INSTANCE_ADMIN_EMAIL=admin@example.com INSTANCE_ADMIN_PASSWORD=Sup3rSecret!
npm run build && npm run db:init
```

Expected: logs "migrations applied" → "instance registered + configured" → "instance admin seeded" → "db:init complete", exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/nestjs-api/src/db-init.ts apps/nestjs-api/src/main.ts apps/nestjs-api/src/infra/database/drizzle.module.ts apps/nestjs-api/.env.example
git commit -m "feat(nestjs-api): db:init CLI + seed-on-boot hook"
```

---

### Task B4: End-to-end verification — the auth error is gone

**Files:**

- Test: `apps/nestjs-api/test/instances-endpoint.e2e.spec.ts`

- [ ] **Step 1: Write the end-to-end test**

```typescript
// apps/nestjs-api/test/instances-endpoint.e2e.spec.ts
import { Test } from "@nestjs/testing";
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../src/app.module";
import { InstanceBootstrapService } from "../src/infra/database/instance-bootstrap.service";
import { AdminSeedService } from "../src/infra/database/admin-seed.service";

describe("GET /api/instances", () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.INSTANCE_ADMIN_EMAIL = "admin@example.com";
    process.env.INSTANCE_ADMIN_PASSWORD = "Sup3rSecret!";
    process.env.SEED_ON_BOOT = "0";
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    await app.get(InstanceBootstrapService).run();
    await app.get(AdminSeedService).run();
  });
  afterAll(() => app.close());

  it("returns config with email/password enabled and is_setup_done=true", async () => {
    const res = await request(app.getHttpServer()).get("/api/instances").expect(200);
    expect(res.body.config.is_email_password_enabled).toBe(true);
    expect(res.body.instance.is_setup_done).toBe(true);
  });
});
```

- [ ] **Step 2: Run it (fails if any wiring is wrong)**

Run: `cd apps/nestjs-api && npm run test:e2e -- instances-endpoint`
Expected: PASS — `config` present, `is_email_password_enabled=true`, `is_setup_done=true`. This is the exact condition that makes `auth-root.tsx` render the sign-in form instead of "No authentication methods available."

- [ ] **Step 3: Full suite + typecheck**

Run: `cd apps/nestjs-api && npm run typecheck && npm run test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/nestjs-api/test/instances-endpoint.e2e.spec.ts
git commit -m "test(nestjs-api): e2e — /api/instances returns auth config + setup done"
```

---

## Self-Review

**Spec coverage:** Layer 1 → A1–A3; Layer 2 (register/configure, Findings 2 & 3) → B1; Layer 3 (headless admin, Finding 1) → B2; CLI + seed-on-boot → B3; data-flow verification → B4. Finding 4 (audit columns/unique constraints) is covered by A2/A3. Non-goals (GitHub version call, telemetry, create_bucket, clear_cache) are excluded.

**Manual step callout:** A2 requires a Django-migrated reference DB and `drizzle-kit pull`; this is dev-time only and explicitly logged, not silently assumed.

**Type consistency:** `run()` is the public entry on both services; `InstanceBootstrapService(db, crypto, cfg)` and `AdminSeedService(db, cfg)` constructor shapes match across tasks and tests; `makeDjangoPassword` / `verifyDjangoPassword` names match the existing util; schema exports (`profiles`, `instanceAdmins`, `instances`, `instanceConfigurations`) match usage.

**Known trade-off:** `notification_view_mode` default `"full"` and `background_color` default are cosmetic; verify the exact enum value in `plane/db/models/user.py` if strict parity matters.
