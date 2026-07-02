# 02 — Data Layer (Drizzle ORM)

The largest single part of the port: ~90 models, the base-model behaviors that Django applies implicitly,
and the strategy for sharing one Postgres schema with Django.

## 0. Four ground truths that shape everything

Established by reading `plane/db/mixins.py`, `plane/db/models/base.py`, `.../issue.py`, `.../asset.py`,
`.../session.py`, and `plane/bgtasks/deletion_task.py`:

1. **Django applies almost all "defaults" in Python, not in the DB.** Callable defaults (`default=uuid4`,
   `default=dict/list`, `default=get_random_color`) and scalar defaults (`default="none"`,
   `default="<p></p>"`, `default=65535`) are applied by the ORM at insert time. The introspected columns
   mostly have **no** column-level default → reproduce defaults in JS (`.$defaultFn()` / repository logic),
   not with `.default()`.
2. **Every "enum" is a `varchar`, not a PG enum.** `TextChoices`/`choices` (State.group, Issue.priority,
   FileAsset.entity_type, IssueRelation.relation_type, …) are plain `CharField`. **Do not** create
   `pgEnum` — model as `varchar` + a TypeScript union / Zod enum for validation.
3. **`on_delete` is app-level, not in the DB.** Django FKs are created as plain `NO ACTION` constraints;
   `CASCADE`/`SET_NULL`/`DO_NOTHING` live only in Python (and in `soft_delete_related_objects`). The
   introspected FK metadata will **not** tell us the intended cascade behavior — we encode it ourselves
   (§2 cascade registry).
4. **Soft-delete is the default read filter.** `SoftDeletionManager.get_queryset()` adds
   `deleted_at IS NULL` on every default query; `all_objects` (and model-specific managers) bypass it.
   Partial unique indexes (`… when_deleted_at_null`) enforce uniqueness only over live rows.

## 1. Schema organization

### Directory layout (mirror `plane/db/models/*.py`)

```
src/db/                         # (or src/infra/database/)
  drizzle.module.ts             # DI: DRIZZLE (+ DRIZZLE_RO replica) providers
  client.ts                     # postgres-js pool + drizzle(db, { schema, casing: 'snake_case' })
  base.repository.ts            # soft-delete scope + audit stamping (§4)
  project-scoped.repository.ts  # + tenancy derivation (§4)
  schema/
    _columns.ts                 # reusable column groups (base/time/user/soft/tenancy)
    _types.ts                   # bytea customType, enum unions
    index.ts                    # barrel: re-export every table + relations
    user.schema.ts  workspace.schema.ts  project.schema.ts  issue.schema.ts
    asset.schema.ts  state.schema.ts  label.schema.ts  cycle.schema.ts  module.schema.ts
    page.schema.ts  view.schema.ts  intake.schema.ts  estimate.schema.ts
    notification.schema.ts  webhook.schema.ts  api.schema.ts  session.schema.ts  … (34 files)
    relations.ts                # all relations() in one place (loads after tables → no TDZ cycles)
  cascade/
    cascade-registry.ts         # generated on_delete graph (§2 cascade)
```

One schema file per Django model file keeps the ~90 tables navigable and lets a reviewer diff
`issue.schema.ts` against `issue.py`. Relations are centralized in `relations.ts` to give the relational
query builder full typing while avoiding circular top-level references between table modules.

### Reusable column groups (`_columns.ts`)

Django's mixin inheritance (`BaseModel` = `TimeAuditModel` + `UserAuditModel` + `SoftDeleteModel` + UUID PK)
becomes spreadable objects:

```ts
import { sql } from 'drizzle-orm';
import { uuid, timestamp } from 'drizzle-orm/pg-core';

// TimeAuditModel — auto_now_add / auto_now reproduced in JS (DB has no default, ground-truth #1)
export const timeAudit = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .$defaultFn(() => new Date()).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
};

// UserAuditModel — plain uuid columns, NO .references() here (FK declared in relations.ts to
// avoid a _columns <-> user.schema import cycle). SET_NULL enforced by the cascade worker, not the DB.
export const userAudit = {
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
};

export const softDelete = { deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }) };

// BaseModel = UUID PK (uuid4 generated in JS, matching Django) + all three mixins
export const baseColumns = {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ...timeAudit, ...userAudit, ...softDelete,
};

// WorkspaceBaseModel: workspace (CASCADE) + project (CASCADE, nullable)
export const workspaceScoped = {
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id'),
};
// ProjectBaseModel: project (CASCADE) + workspace (CASCADE), both NOT NULL
export const projectScoped = {
  projectId: uuid('project_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
};
```

> `.$defaultFn(() => crypto.randomUUID())` is used instead of `.defaultRandom()` because Django generates
> the UUID in Python; the introspected column has no `gen_random_uuid()` default. This keeps ID generation
> identical and matches the DB reality.

### Postgres-specific types (`_types.ts`)

```ts
import { customType } from 'drizzle-orm/pg-core';

// BinaryField -> bytea (Issue.description_binary holds the Yjs doc written by apps/live)
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

// Django CharField(choices=...) are varchar — model values as unions (ground-truth #2):
export const ISSUE_PRIORITY = ['urgent','high','medium','low','none'] as const;
export type IssuePriority = (typeof ISSUE_PRIORITY)[number];
export const ASSET_ENTITY_TYPE = [
  'ISSUE_ATTACHMENT','ISSUE_DESCRIPTION','COMMENT_DESCRIPTION','PAGE_DESCRIPTION','USER_COVER',
  'USER_AVATAR','WORKSPACE_LOGO','PROJECT_COVER','DRAFT_ISSUE_ATTACHMENT','DRAFT_ISSUE_DESCRIPTION',
] as const;
export type AssetEntityType = (typeof ASSET_ENTITY_TYPE)[number];
```

### Type mapping cheat-sheet (Django → Drizzle/PG)

| Django field | Drizzle |
|---|---|
| `UUIDField` (PK) | `uuid(...).primaryKey().$defaultFn(crypto.randomUUID)` |
| `CharField(max_length=n)` / `SlugField` / `URLField` | `varchar(name,{length:n})` |
| `TextField` | `text(name)` |
| `CharField(choices=…)` | `varchar` + TS union (**never** `pgEnum`) |
| `IntegerField` | `integer` |
| `PositiveSmallIntegerField` (role, retry_count) | `smallint` |
| `PositiveBigIntegerField` (IssueSequence.sequence) | `bigint({mode:'number'|'bigint'})` |
| `FloatField` (sort_order, sequence, epoch) | `doublePrecision` |
| `BooleanField` | `boolean` |
| `DateField` (start_date, target_date, archived_at) | `date(name,{mode:'string'})` |
| `DateTimeField` (USE_TZ=True) | `timestamp(name,{withTimezone:true,mode:'date'})` |
| `JSONField` | `jsonb(name)` |
| `BinaryField` | `bytea(name)` |
| `ArrayField(URLField)` (attachments) | `text(name).array()` |
| `ArrayField(UUIDField)` (IssueVersion.assignees/labels/modules) | `uuid(name).array()` |

### Representative snippet — `issues`

```ts
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, integer, doublePrecision, boolean, date, timestamp,
         jsonb, index, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { baseColumns } from './_columns';
import { bytea, ISSUE_PRIORITY, type IssuePriority } from './_types';

export const issues = pgTable('issues', {
  ...baseColumns,                                   // id, created/updated_at, created/updated_by, deleted_at
  projectId: uuid('project_id').notNull(),          // ProjectBaseModel tenancy (CASCADE via registry)
  workspaceId: uuid('workspace_id').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => issues.id, { onDelete: 'cascade' }),
  stateId: uuid('state_id'),
  point: integer('point'),
  estimatePointId: uuid('estimate_point_id'),
  name: varchar('name', { length: 255 }).notNull(),
  descriptionJson: jsonb('description_json').$type<Record<string, unknown>>().$defaultFn(() => ({})),
  descriptionHtml: text('description_html').$defaultFn(() => '<p></p>'),
  descriptionStripped: text('description_stripped'),
  descriptionBinary: bytea('description_binary'),   // Yjs binary (authored by apps/live)
  priority: varchar('priority', { length: 30 }).$type<IssuePriority>().$defaultFn(() => 'none'),
  startDate: date('start_date', { mode: 'string' }),
  targetDate: date('target_date', { mode: 'string' }),
  sequenceId: integer('sequence_id').$defaultFn(() => 1),   // real value set under advisory lock (§3a)
  sortOrder: doublePrecision('sort_order').$defaultFn(() => 65535),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  archivedAt: date('archived_at', { mode: 'string' }),
  isDraft: boolean('is_draft').$defaultFn(() => false),
  externalSource: varchar('external_source', { length: 255 }),
  externalId: varchar('external_id', { length: 255 }),
  typeId: uuid('type_id'),
}, (t) => [
  index('issues_project_id_...').on(t.projectId),   // names must match introspected DB objects
  index('issues_workspace_id_...').on(t.workspaceId),
  index('issues_state_id_...').on(t.stateId),
]);
```

### Representative snippet — through-table `issue_assignees`

`IssueAssignee` is a `ProjectBaseModel`, so the M2M "through" row has its own UUID PK, audit, soft-delete,
and tenancy (this is why it can't be a bare composite-PK join table):

```ts
import { projectScoped } from './_columns';

export const issueAssignees = pgTable('issue_assignees', {
  ...baseColumns, ...projectScoped,                  // + project_id, workspace_id (NOT NULL)
  issueId: uuid('issue_id').notNull(),
  assigneeId: uuid('assignee_id').notNull(),
}, (t) => [
  uniqueIndex('issue_assignees_issue_id_assignee_id_deleted_at_...')       // unique_together incl. deleted_at
    .on(t.issueId, t.assigneeId, t.deletedAt),
  uniqueIndex('issue_assignee_unique_issue_assignee_when_deleted_at_null') // partial unique over live rows
    .on(t.issueId, t.assigneeId).where(sql`${t.deletedAt} IS NULL`),
]);
```

> Special case: the `users` table (`db_table='users'`) extends `AbstractBaseUser`, **not** `BaseModel`.
> It has a UUID PK + its own `created_at`/`updated_at` but **no** `created_by`/`updated_by`/`deleted_at`,
> so it does **not** spread `baseColumns`. The `sessions` table likewise has a custom shape (see [`03`](./03-auth-and-rbac.md) §0).

## 2. Base-mixin replication strategy

Drizzle has no query middleware/hooks. Every base behavior is centralized in a **`BaseRepository`** plus a
request-scoped context, so the ~90 tables inherit behavior instead of reimplementing it.

### 2a. Audit fields from a request-scoped current user (`nestjs-cls`)

`crum.get_current_user()` is thread-local; the Node equivalent is `nestjs-cls` (AsyncLocalStorage):

```ts
// app.module.ts
ClsModule.forRoot({ global: true, middleware: { mount: true } });
```

A `RequestContextInterceptor` (running after the auth guard) copies `req.user?.id` into CLS; the repository
reproduces `BaseModel.save()`:

```ts
protected stampInsert<V extends object>(v: V) {         // create: set created_by, leave updated_by null
  return { createdBy: this.cls.get('userId') ?? null, updatedBy: null, ...v };
}
protected stampUpdate<V extends object>(v: V) {         // update: set updated_by only
  return { ...v, updatedBy: this.cls.get('userId') ?? null };
}
```

Escape hatches mirror `base.py`: repo methods accept `{ actorId?, disableAutoSetUser? }` (like
`disable_auto_set_user` / explicit `created_by_id`).

### 2b. Soft-delete default filter + `all_objects` escape hatch

```ts
protected defaultScope(): SQL | undefined { return isNull(this.table.deletedAt); }
find(where?: SQL, opts?: { includeDeleted?: boolean }) {
  const scope = opts?.includeDeleted ? undefined : this.defaultScope();
  return this.db.select().from(this.table).where(and(scope, where));
}
```

Model-specific managers (extra default filters) are `defaultScope()` overrides:
- `IssueManager` (excludes triage state + archived + draft) → `IssueRepository.defaultScope()`.
- `StateManager` (excludes triage) → `StateRepository.defaultScope()`; `all_state_objects`/`triage_objects`
  become named methods (`findAllIncludingTriage()`, `findTriage()`).

Soft `delete()` reproduces `SoftDeleteModel.delete()` — set `deleted_at`, stamp `updated_by`, enqueue cascade:

```ts
async softDelete(id: string) {
  const now = new Date();
  await this.db.update(this.table)
    .set({ deletedAt: now, updatedBy: this.cls.get('userId') ?? null })
    .where(eq(this.table.id, id));
  await this.celery.enqueue(CELERY_TASKS.softDeleteRelated, { table: this.tableName, id, deleted_at: now.toISOString() });
}
```

### 2c. Cascade modeling — the hardest behavior (generated registry)

`soft_delete_related_objects` (`deletion_task.py`) walks **reverse** relations at runtime via Django's model
registry, reads each relation's `on_delete`, and skips `DO_NOTHING` / nulls the FK for `SET_NULL` /
recursively soft-deletes for `CASCADE`. Drizzle has **no** runtime relation/`on_delete` registry and the
DB FKs don't encode `on_delete` (ground-truth #3), so this cannot be derived automatically.

**Solution: a generated static cascade registry** — one entry per table listing reverse relations with their
behavior, **code-generated by a one-off script that parses `on_delete=` + `related_name` from the Django
`.py` models** (so it stays honest as Django evolves). A worker replicates the recursion.

```ts
// cascade/cascade-registry.ts  (generated; excerpt)
export const CASCADE_REGISTRY: Record<string, ReverseRel[]> = {
  issues: [
    { childTable: 'issue_assignees', fk: 'issue_id', onDelete: 'CASCADE' },
    { childTable: 'issue_labels',    fk: 'issue_id', onDelete: 'CASCADE' },
    { childTable: 'issue_comments',  fk: 'issue_id', onDelete: 'CASCADE' },
    { childTable: 'issue_sequences', fk: 'issue_id', onDelete: 'SET_NULL' },
    { childTable: 'issue_activities',fk: 'issue_id', onDelete: 'DO_NOTHING' },
    // …
  ],
  // …one entry per table
};
```

```ts
async function softDeleteRelated(table: string, id: string, when: Date) {
  for (const rel of CASCADE_REGISTRY[table] ?? []) {
    const child = tables[rel.childTable];
    if (rel.onDelete === 'DO_NOTHING') continue;
    if (rel.onDelete === 'SET_NULL') {
      await db.update(child).set({ [rel.fk]: null }).where(eq(child[rel.fk], id)); continue;
    }
    const rows = await db.select({ id: child.id }).from(child)
      .where(and(eq(child[rel.fk], id), isNull(child.deletedAt)));
    for (const r of rows) {
      await db.update(child).set({ deletedAt: when }).where(eq(child.id, r.id));
      await softDeleteRelated(rel.childTable, r.id, when);   // recurse, mirroring the Django task
    }
  }
}
```

A test asserts **every FK column in the schema appears in the registry** (no silent gaps). `restore_related_objects`
(currently commented out in Django) is not ported. `hard_delete` (retention sweep) is a scheduled job (§3 / [`05`](./05-background-jobs.md)).

### 2d. Tenancy auto-derivation

`WorkspaceBaseModel.save()` copies `workspace = project.workspace` when a project is set; `ProjectBaseModel.save()`
always copies it. Reproduced in `ProjectScopedRepository`:

```ts
protected async deriveTenancy<V extends { projectId?: string; workspaceId?: string }>(v: V) {
  if (v.projectId && !v.workspaceId) {
    const [p] = await this.db.select({ w: projects.workspaceId }).from(projects).where(eq(projects.id, v.projectId));
    (v as any).workspaceId = p.w;
  }
  return v;
}
```

### 2e. Partial unique constraints

Django `UniqueConstraint(fields=[…], condition=Q(deleted_at__isnull=True), name=…)` → Postgres partial
unique index → `uniqueIndex(name).on(cols).where(sql\`…\`)`. Both the plain `unique_together` (incl.
`deleted_at`) **and** the partial index must be represented for a clean introspection round-trip. `Label`'s
conditional constraints add `project IS NULL` / `project IS NOT NULL` to `.where()`:

```ts
uniqueIndex('unique_name_when_project_null_and_not_deleted')
  .on(t.name).where(sql`${t.projectId} IS NULL AND ${t.deletedAt} IS NULL`),
uniqueIndex('unique_project_name_when_not_deleted')
  .on(t.projectId, t.name).where(sql`${t.projectId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
```

## 3. Special cases

### 3a. Advisory-lock `sequence_id` (Issue create)

Port `convert_uuid_to_integer` exactly (sha256, first 8 bytes, big-endian, **signed** 64-bit → PG `bigint`),
then reproduce `Issue.save()` inside one transaction so `pg_advisory_xact_lock` is held for the whole insert:

```ts
export function uuidToLockKey(uuid: string): bigint {
  return createHash('sha256').update(uuid).digest().readBigInt64BE(0);
}

async createIssue(input: NewIssue) {
  return this.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${uuidToLockKey(input.projectId)})`);
    const [{ largest }] = await tx.select({ largest: max(issueSequences.sequence) })
      .from(issueSequences).where(eq(issueSequences.projectId, input.projectId));
    const sequenceId = largest ? Number(largest) + 1 : 1;
    const stateId = input.stateId ?? await this.resolveDefaultState(tx, input.projectId);   // _ensure_default_state
    const [{ largestSort }] = await tx.select({ largestSort: max(issues.sortOrder) })
      .from(issues).where(and(eq(issues.projectId, input.projectId), eq(issues.stateId, stateId)));
    const sortOrder = largestSort != null ? largestSort + 10000 : 65535;
    const completedAt = await this.completedAtFor(tx, stateId);                              // _sync_completed_at
    const [issue] = await tx.insert(issues).values(this.stampInsert(await this.deriveTenancy({
      ...input, stateId, sequenceId, sortOrder, completedAt,
      descriptionStripped: stripHtml(input.descriptionHtml ?? ''),
    }))).returning();
    await tx.insert(issueSequences).values(this.stampInsert(await this.deriveTenancy(
      { issueId: issue.id, sequence: sequenceId, projectId: input.projectId })));
    return issue;
  });
}
```

`ChangeTrackerMixin` (tracked `state_id`) is only needed to drive `_sync_completed_at` on **update**: compare
the incoming `stateId` against the current row (`SELECT … FOR UPDATE` before the update) — a DB-backed
equivalent of the in-memory snapshot. Comment/description change-tracking uses the same diff approach.

### 3b. The rich-text quad

`description_json` (jsonb, ProseMirror), `description_html` (text), `description_stripped` (text, search),
`description_binary` (bytea, Yjs CRDT). Rules:
- On every write, set `description_stripped = stripHtml(description_html)` (empty html → `null`). Centralize
  in `RichTextService.normalize({json, html})` used by Issue, Description, DraftIssue, and version tables.
  `stripHtml` reuses the `@tiptap/html` approach `apps/live` already depends on.
- `description_binary` is authored by `apps/live`, not the CRUD API → treat as read/passthrough; never
  clobber on plain field updates (mirrors Django `save()`).
- `IssueComment` has a **1:1 `Description`** (`descriptionId`): reproduce `IssueComment.save()` in a
  transaction (insert comment + insert `descriptions` row + set `comment.descriptionId`; on update, only
  `UPDATE descriptions` for changed `comment_*` fields).
- Version snapshots (`IssueVersion`, `IssueDescriptionVersion`, `DescriptionVersion`) are Django
  `@classmethod` loggers → `*VersionService.log(entity, userId)` gathering assignee/label/module id arrays
  via `array_agg`.

### 3c. Manual polymorphic FK (`FileAsset`)

`file_assets` has both `entity_type` (varchar tag) + `entity_identifier` (varchar UUID-as-text) **and**
concrete nullable FKs (`user_id`, `workspace_id`, `project_id`, `issue_id`, `comment_id`, `page_id`,
`draft_issue_id`). Schema = all nullable `uuid` FKs + two `varchar(255)` + the four named indexes.
`AssetService` maps entity_type → FK column and builds the `asset_url` (the Django `@property`) as a pure
DTO function producing the same `/api/assets/v2/…` paths. `is_deleted`/`is_archived` are booleans distinct
from `deleted_at` soft-delete (upload lifecycle) — keep both.

## 4. Repository / data-access pattern

Two base classes carry all four behaviors; per-domain repos add business queries.

```ts
// db/base.repository.ts
export abstract class BaseRepository<T extends PgTable & {
  id: PgColumn; deletedAt: PgColumn; createdBy: PgColumn; updatedBy: PgColumn;
}> {
  constructor(protected db: NodePgDatabase<typeof schema>, protected table: T, protected cls: ClsService) {}
  protected defaultScope(): SQL | undefined { return isNull(this.table.deletedAt); }
  protected stampInsert<V extends object>(v: V) { return { createdBy: this.cls.get('userId') ?? null, updatedBy: null, ...v }; }
  protected stampUpdate<V extends object>(v: V) { return { ...v, updatedBy: this.cls.get('userId') ?? null }; }
  find(where?: SQL, opts?: { includeDeleted?: boolean }) {
    return this.db.select().from(this.table as PgTable).where(and(opts?.includeDeleted ? undefined : this.defaultScope(), where));
  }
  async findById(id: string, opts?: { includeDeleted?: boolean }) { const [r] = await this.find(eq(this.table.id, id), opts).limit(1); return r ?? null; }
  async create(values: T['$inferInsert']) { const [r] = await this.db.insert(this.table).values(this.stampInsert(values)).returning(); return r; }
  async update(id: string, values: Partial<T['$inferInsert']>) { const [r] = await this.db.update(this.table).set(this.stampUpdate(values)).where(eq(this.table.id, id)).returning(); return r; }
  async softDelete(id: string) { /* §2b */ }
  hardDelete(id: string) { return this.db.delete(this.table).where(eq(this.table.id, id)); }
}

// db/project-scoped.repository.ts
export abstract class ProjectScopedRepository<T extends PgTable & {…}> extends BaseRepository<T> {
  protected async deriveTenancy(v) { /* §2d */ return v; }
  async create(values: T['$inferInsert']) { return super.create(await this.deriveTenancy(values as any)); }
}
```

```ts
// issue/issue.repository.ts
@Injectable()
export class IssueRepository extends ProjectScopedRepository<typeof issues> {
  constructor(@Inject(DRIZZLE) db, cls: ClsService) { super(db, issues, cls); }
  protected defaultScope() {   // IssueManager: exclude triage / archived / draft
    return and(isNull(issues.deletedAt), isNull(issues.archivedAt), eq(issues.isDraft, false) /* + state.group != triage */);
  }
  createIssue = /* §3a */;
}
```

`$inferInsert`/`$inferSelect` give per-table row types for free; DTOs/serializers sit above the repo.
Result: the four base behaviors live in **two** base classes, not 90 copies.

### `post_save`-signal side effects

Django signals (User → creates `UserNotificationPreference`; ProjectMember → creates `ProjectUserProperty`)
have no Drizzle hook → encode as explicit steps inside the corresponding service `create()`, in the same
transaction. Other per-model `save()` logic (`State.save` sequence bump, `Label.save` sort_order bump,
`Project.save` timezone-from-workspace + identifier upper-casing, `Workspace.delete()` slug suffixing) lives
in the respective domain service, not the base repository.

## 5. Schema sync workflow (Django owns migrations)

### Bootstrap by introspection
```ts
// drizzle.config.ts
export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  schema: './src/db/schema/index.ts',
  out: './drizzle',                 // introspection output only — never used for `migrate`
  introspect: { casing: 'camel' },
});
```
Run `pnpm drizzle-kit pull` against a **fully-migrated** DB (spin up Postgres, run Django
`python manage.py migrate` first). The generated `schema.ts`/`relations.ts` + snapshot is the **starting
point** and the source of truth for exact column/index/constraint **names**. Then refactor into per-domain
files, swap DB-default columns for `$defaultFn` (ground-truth #1), and enum columns for `varchar`+union
(ground-truth #2).

### Stay aligned without owning migrations
- **Never** run `drizzle-kit generate`/`migrate` against these tables. Django's migration graph is the sole
  DDL writer; Drizzle is read/write **DML only**.
- **CI drift gate** (every PR): boot Postgres → run Django `migrate` from `apps/api` → `drizzle-kit pull`
  into a temp dir → diff against the committed introspection snapshot. Any divergence (a new Django
  migration changed the schema) fails CI, signaling the Drizzle schema (and cascade registry) must be updated.
- **Runtime safety net**: on boot, query `django_migrations` for the latest applied name and compare to the
  version the Drizzle schema was generated for; log loudly / refuse to start in non-prod on mismatch.

## 6. Django behaviors hard to replicate — and the pragmatic call

| # | Django behavior | Pragmatic solution |
|---|---|---|
| 1 | Reverse-relation soft-delete cascade (`soft_delete_related_objects`) | Generated static cascade registry + recursive worker (§2c); code-generated + test-covered. |
| 2 | Python-applied defaults (callables + scalars) | `.$defaultFn()` / repository logic, never `.default()` (§1). |
| 3 | `post_save` signals | Explicit steps inside service `create()`, same transaction (§4). |
| 4 | Model manager default filters (`IssueManager`, `StateManager`, `all_objects`, `triage_objects`) | `defaultScope()` overrides + named escape-hatch methods (§2b). |
| 5 | `ChangeTrackerMixin` in-memory diffing | DB-backed old-vs-new comparison (`SELECT … FOR UPDATE`) (§3a/3b). |
| 6 | `Workspace.delete()` slug-suffix / `hard_delete()` retention sweep | Service override / scheduled cron job. |

## 7. Fidelity checklist (this layer must pass)

- [ ] `drizzle-kit pull` on a Django-migrated DB round-trips against the committed schema (no diff).
- [ ] Inserting through a repository sets `created_by`/`updated_by`, `created_at`/`updated_at`, and a UUID id
      identical in shape to Django.
- [ ] Default queries exclude soft-deleted rows; `{ includeDeleted: true }` returns them.
- [ ] Creating an issue produces the correct per-project sequential `sequence_id` under concurrency (advisory lock).
- [ ] Soft-deleting a parent cascades exactly like `soft_delete_related_objects` (CASCADE/SET_NULL/DO_NOTHING).
- [ ] Every FK column appears in the cascade registry (test-enforced).
- [ ] Partial unique constraints reject duplicate live rows but allow re-creation after soft-delete.
