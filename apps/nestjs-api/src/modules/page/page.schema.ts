import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { baseColumns } from "../../infra/database/schema/_columns";
import { bytea } from "../../infra/database/schema/_types";

// Page.access is a PositiveSmallIntegerField(choices=((0,"Public"),(1,"Private")), default=0) — a
// plain smallint in the DB (never pgEnum), modelled as a TS union of the numeric choices.
export const PAGE_ACCESS = { PUBLIC: 0, PRIVATE: 1 } as const;
export const PAGE_ACCESS_VALUES = [PAGE_ACCESS.PUBLIC, PAGE_ACCESS.PRIVATE] as const;
export type PageAccess = (typeof PAGE_ACCESS_VALUES)[number];

// view_props default: {"full_width": False} (plane/db/models/page.py get_view_props).
const defaultViewProps = (): Record<string, unknown> => ({ full_width: false });

// db_table = "pages". Page extends BaseModel and is WORKSPACE-scoped (workspace FK); it has NO
// project_id column — projects are attached through the project_pages join (M2M ProjectPage).
// Rich-text quad: description_json (jsonb) / description_html (text) / description_stripped (text)
// / description_binary (bytea, written by apps/live — passthrough only, sync deferred).
export const pages = pgTable("pages", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull().$defaultFn(() => ""),
  descriptionJson: jsonb("description_json").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  descriptionBinary: bytea("description_binary"),
  descriptionHtml: text("description_html").$defaultFn(() => "<p></p>"),
  descriptionStripped: text("description_stripped"),
  // Django FK `owned_by` -> DB column `owned_by_id` (matches the reference; the `ownedBy` property
  // name is unchanged so repositories/serializers are unaffected).
  ownedBy: uuid("owned_by_id").notNull(),
  access: smallint("access").$type<PageAccess>().notNull().$defaultFn(() => PAGE_ACCESS.PUBLIC),
  color: varchar("color", { length: 255 }).$defaultFn(() => ""),
  parentId: uuid("parent_id").references((): AnyPgColumn => pages.id, { onDelete: "cascade" }),
  archivedAt: date("archived_at", { mode: "string" }),
  isLocked: boolean("is_locked").notNull().$defaultFn(() => false),
  viewProps: jsonb("view_props").$type<Record<string, unknown>>().$defaultFn(defaultViewProps),
  logoProps: jsonb("logo_props").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  isGlobal: boolean("is_global").notNull().$defaultFn(() => false),
  movedToPage: uuid("moved_to_page"),
  movedToProject: uuid("moved_to_project"),
  sortOrder: doublePrecision("sort_order").$defaultFn(() => 65535),
  externalSource: varchar("external_source", { length: 255 }),
  externalId: varchar("external_id", { length: 255 }),
});

// db_table = "project_pages" (M2M through Page<->Project). Carries workspace_id like the Django model.
export const projectPages = pgTable(
  "project_pages",
  {
    ...baseColumns,
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    pageId: uuid("page_id").notNull(),
  },
  (t) => [
    uniqueIndex("project_page_unique_project_page_when_deleted_at_null")
      .on(t.projectId, t.pageId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// db_table = "page_labels" (M2M through Page<->Label). BaseModel + workspace FK (no project_id).
export const pageLabels = pgTable("page_labels", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
  pageId: uuid("page_id").notNull(),
  labelId: uuid("label_id").notNull(),
});

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type ProjectPage = typeof projectPages.$inferSelect;
export type PageLabel = typeof pageLabels.$inferSelect;
