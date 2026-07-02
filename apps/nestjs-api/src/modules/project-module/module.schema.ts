import { sql } from "drizzle-orm";
import {
  date,
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { baseColumns, projectScoped } from "../../infra/database/schema/_columns";

// db_table = "modules" (Module extends ProjectBaseModel). status is a varchar (choices), not pgEnum.
export const MODULE_STATUS = ["backlog", "planned", "in-progress", "paused", "completed", "cancelled"] as const;
export type ModuleStatus = (typeof MODULE_STATUS)[number];

export const modules = pgTable(
  "modules",
  {
    ...baseColumns,
    ...projectScoped,
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").$defaultFn(() => ""),
    // description_text / description_html are JSONField(null=True) — Yjs/rich-text payloads.
    descriptionText: jsonb("description_text").$type<Record<string, unknown> | null>(),
    descriptionHtml: jsonb("description_html").$type<Record<string, unknown> | null>(),
    // DateField -> date (drizzle string mode: "YYYY-MM-DD"), matching Django's DateField JSON output.
    startDate: date("start_date"),
    targetDate: date("target_date"),
    status: varchar("status", { length: 20 }).$type<ModuleStatus>().$defaultFn(() => "planned"),
    // lead = FK User (SET_NULL, nullable). Plain uuid (no .references() — cascade is app-level).
    leadId: uuid("lead_id"),
    viewProps: jsonb("view_props").$type<Record<string, unknown>>().$defaultFn(() => ({})),
    sortOrder: doublePrecision("sort_order").$defaultFn(() => 65535),
    externalSource: varchar("external_source", { length: 255 }),
    externalId: varchar("external_id", { length: 255 }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    logoProps: jsonb("logo_props").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  },
  (t) => [
    uniqueIndex("module_unique_name_project_when_deleted_at_null")
      .on(t.name, t.projectId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// db_table = "module_members" (ModuleMember extends ProjectBaseModel) — Module.members M2M through table.
export const moduleMembers = pgTable(
  "module_members",
  {
    ...baseColumns,
    ...projectScoped,
    moduleId: uuid("module_id")
      .notNull()
      .references((): AnyPgColumn => modules.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull(),
  },
  (t) => [
    uniqueIndex("module_member_unique_module_member_when_deleted_at_null")
      .on(t.moduleId, t.memberId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type Module = typeof modules.$inferSelect;
export type NewModule = typeof modules.$inferInsert;
export type ModuleMember = typeof moduleMembers.$inferSelect;
export type NewModuleMember = typeof moduleMembers.$inferInsert;
