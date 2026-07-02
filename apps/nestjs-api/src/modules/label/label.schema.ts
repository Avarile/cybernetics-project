import { sql } from "drizzle-orm";
import { doublePrecision, pgTable, text, uniqueIndex, uuid, varchar, type AnyPgColumn } from "drizzle-orm/pg-core";
import { baseColumns, workspaceScoped } from "../../infra/database/schema/_columns";

// db_table = "labels" (Label extends WorkspaceBaseModel — project is nullable).
export const labels = pgTable(
  "labels",
  {
    ...baseColumns,
    ...workspaceScoped, // workspace_id NOT NULL, project_id nullable
    parentId: uuid("parent_id").references((): AnyPgColumn => labels.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").$defaultFn(() => ""),
    color: varchar("color", { length: 255 }),
    sortOrder: doublePrecision("sort_order").$defaultFn(() => 65535),
    externalSource: varchar("external_source", { length: 255 }),
    externalId: varchar("external_id", { length: 255 }),
  },
  (t) => [
    uniqueIndex("unique_name_when_project_null_and_not_deleted")
      .on(t.name)
      .where(sql`${t.projectId} IS NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex("unique_project_name_when_not_deleted")
      .on(t.projectId, t.name)
      .where(sql`${t.projectId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  ],
);

export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;
