import { jsonb, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "../../infra/database/schema/_columns";

// db_table = "analytic_views" (AnalyticView extends BaseModel). Workspace-scoped saved analytics view.
// `query` is a computed JSON filter (issue_filters(query_dict, "POST")); `query_dict` is the raw params.
export const analyticViews = pgTable("analytic_views", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").$defaultFn(() => ""),
  query: jsonb("query").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  queryDict: jsonb("query_dict").$type<Record<string, unknown>>().$defaultFn(() => ({})),
});

export type AnalyticView = typeof analyticViews.$inferSelect;
export type NewAnalyticView = typeof analyticViews.$inferInsert;
