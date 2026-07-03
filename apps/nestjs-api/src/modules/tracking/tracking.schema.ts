import { jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns, projectScoped, workspaceScoped } from "../../infra/database/schema/_columns";

// db_table = "user_recent_visits" (UserRecentVisit extends WorkspaceBaseModel).
export const userRecentVisits = pgTable("user_recent_visits", {
  ...baseColumns,
  ...workspaceScoped,
  entityIdentifier: uuid("entity_identifier"),
  entityName: varchar("entity_name", { length: 30 }).notNull(),
  userId: uuid("user_id").notNull(),
  visitedAt: timestamp("visited_at", { withTimezone: true, mode: "date" }).$defaultFn(() => new Date()),
});

// db_table = "issue_links" (IssueLink extends ProjectBaseModel).
export const issueLinks = pgTable("issue_links", {
  ...baseColumns,
  ...projectScoped,
  issueId: uuid("issue_id").notNull(),
  title: varchar("title", { length: 255 }),
  url: text("url").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().$defaultFn(() => ({})),
});

export type UserRecentVisit = typeof userRecentVisits.$inferSelect;
export type IssueLink = typeof issueLinks.$inferSelect;
