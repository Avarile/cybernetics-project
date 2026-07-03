import { boolean, doublePrecision, jsonb, pgTable, smallint, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns, workspaceScoped } from "../../infra/database/schema/_columns";

// db_table = "issue_views" (IssueView extends WorkspaceBaseModel — project is nullable, so workspaceScoped).
// JSON defaults mirror plane/db/models/view.py get_default_* functions (applied in JS, per _columns convention).

/** IssueView.access choices: 0 = Private, 1 = Public (default 1). */
export const VIEW_ACCESS = { PRIVATE: 0, PUBLIC: 1 } as const;

export function defaultDisplayFilters(): Record<string, unknown> {
  return {
    group_by: null,
    order_by: "-created_at",
    type: null,
    sub_issue: true,
    show_empty_groups: true,
    layout: "list",
    calendar_date_range: "",
  };
}

export function defaultDisplayProperties(): Record<string, unknown> {
  return {
    assignee: true,
    attachment_count: true,
    created_on: true,
    due_date: true,
    estimate: true,
    key: true,
    labels: true,
    link: true,
    priority: true,
    start_date: true,
    state: true,
    sub_issue_count: true,
    updated_on: true,
  };
}

export const issueViews = pgTable("issue_views", {
  ...baseColumns,
  ...workspaceScoped, // workspace_id NOT NULL, project_id nullable
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").$defaultFn(() => ""),
  // query is derived from `filters` (Django: issue_filters()); read-only on the wire.
  query: jsonb("query").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  filters: jsonb("filters").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  displayFilters: jsonb("display_filters").$type<Record<string, unknown>>().$defaultFn(defaultDisplayFilters),
  displayProperties: jsonb("display_properties").$type<Record<string, unknown>>().$defaultFn(defaultDisplayProperties),
  richFilters: jsonb("rich_filters").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  access: smallint("access").$defaultFn(() => VIEW_ACCESS.PUBLIC),
  sortOrder: doublePrecision("sort_order").$defaultFn(() => 65535),
  pqlFilters: jsonb("pql_filters")
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({ json: {}, stripped: "" })),
  logoProps: jsonb("logo_props").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  // Django FK `owned_by` -> DB column `owned_by_id` (matches the reference; the `ownedBy` property
  // name is unchanged so repositories/serializers are unaffected).
  ownedBy: uuid("owned_by_id").notNull(),
  isLocked: boolean("is_locked").$defaultFn(() => false),
  lastUsedFilter: varchar("last_used_filter", { length: 255 })
    .notNull()
    .$defaultFn(() => "rich_filters"),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
});

export type IssueView = typeof issueViews.$inferSelect;
export type NewIssueView = typeof issueViews.$inferInsert;
