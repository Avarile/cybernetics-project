import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns, projectScoped } from "../../infra/database/schema/_columns";
import { bytea } from "../../infra/database/schema/_types";

// db_table = "api_activity_logs" (written by the X-Api-Key request logger; retention-swept).
export const apiActivityLogs = pgTable("api_activity_logs", {
  ...baseColumns,
  tokenIdentifier: varchar("token_identifier", { length: 255 }),
  path: text("path"),
  method: varchar("method", { length: 10 }),
  queryParams: jsonb("query_params"),
  headers: text("headers"),
  body: text("body"),
  responseCode: integer("response_code"),
  responseBody: text("response_body"),
  ipAddress: varchar("ip_address", { length: 255 }),
  userAgent: text("user_agent"),
});

// db_table = "page_versions" (snapshots; cleanup keeps the latest 20 per page).
export const pageVersions = pgTable("page_versions", {
  ...baseColumns,
  ...projectScoped,
  pageId: uuid("page_id").notNull(),
  ownedById: uuid("owned_by_id"),
  lastSavedAt: timestamp("last_saved_at", { withTimezone: true, mode: "date" }),
  descriptionJson: jsonb("description_json"),
  descriptionHtml: text("description_html"),
  descriptionBinary: bytea("description_binary"),
  descriptionStripped: text("description_stripped"),
});

// db_table = "issue_description_versions" (snapshots; cleanup keeps the latest 20 per issue).
export const issueDescriptionVersions = pgTable("issue_description_versions", {
  ...baseColumns,
  ...projectScoped,
  issueId: uuid("issue_id").notNull(),
  ownedById: uuid("owned_by_id"),
  lastSavedAt: timestamp("last_saved_at", { withTimezone: true, mode: "date" }),
  descriptionJson: jsonb("description_json"),
  descriptionHtml: text("description_html"),
  descriptionBinary: bytea("description_binary"),
  descriptionStripped: text("description_stripped"),
});

export type ApiActivityLog = typeof apiActivityLogs.$inferSelect;
export type PageVersion = typeof pageVersions.$inferSelect;
export type IssueDescriptionVersion = typeof issueDescriptionVersions.$inferSelect;
