import { randomUUID } from "crypto";
import { timestamp, uuid } from "drizzle-orm/pg-core";

// Reusable column groups mirroring Django's model mixins (plane/db/mixins.py + models/base.py).
// Defaults are applied in JS (Django applies them in Python; the DB columns carry no default) —
// see developments/backend/current_design/02-data-layer-drizzle.md ground-truth #1.

/** TimeAuditModel: created_at (auto_now_add), updated_at (auto_now). */
export const timeAudit = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
    .notNull(),
};

/**
 * UserAuditModel: created_by / updated_by. Plain uuid columns (no .references() here to avoid a
 * _columns <-> user.schema import cycle). SET_NULL on user delete is enforced by the cascade worker,
 * not the DB (Django on_delete is app-level).
 *
 * Parity note: the Django-migrated reference DB names these FK columns `created_by_id` / `updated_by_id`
 * (Django appends `_id` to FK fields). The app's repositories/raw-SQL still read/write the legacy
 * `created_by` / `updated_by` columns, so we KEEP those and additionally expose the reference-named
 * columns for full column parity. Both are nullable in the reference (no insert breakage).
 */
export const userAudit = {
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdById: uuid("created_by_id"),
  updatedById: uuid("updated_by_id"),
};

/** SoftDeleteModel: deleted_at (null = live row). */
export const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
};

/** BaseModel = UUID PK (uuid4 generated in JS, matching Django) + the three audit mixins. */
export const baseColumns = {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  ...timeAudit,
  ...userAudit,
  ...softDelete,
};

/** WorkspaceBaseModel: workspace (CASCADE) + project (CASCADE, nullable). */
export const workspaceScoped = {
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id"),
};

/** ProjectBaseModel: project (CASCADE) + workspace (CASCADE), both NOT NULL. */
export const projectScoped = {
  projectId: uuid("project_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
};
