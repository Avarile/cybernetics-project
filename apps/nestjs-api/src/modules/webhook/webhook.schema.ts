import { boolean, integer, jsonb, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "../../infra/database/schema/_columns";

// db_table = "webhooks" (Webhook extends BaseModel, workspace-scoped). Reconciled to full column parity.
export const webhooks = pgTable("webhooks", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
  name: varchar("name", { length: 255 }),
  url: varchar("url", { length: 1024 }).notNull(),
  isActive: boolean("is_active").notNull().$defaultFn(() => true),
  secretKey: varchar("secret_key", { length: 255 }).notNull(),
  project: boolean("project").notNull().$defaultFn(() => false),
  issue: boolean("issue").notNull().$defaultFn(() => false),
  module: boolean("module").notNull().$defaultFn(() => false),
  cycle: boolean("cycle").notNull().$defaultFn(() => false),
  issueComment: boolean("issue_comment").notNull().$defaultFn(() => false),
  isInternal: boolean("is_internal").notNull().$defaultFn(() => false),
  version: varchar("version", { length: 50 }).$defaultFn(() => "v1"),
  contentType: varchar("content_type", { length: 255 })
    .notNull()
    .$defaultFn(() => "application/json"),
  pqlFilters: jsonb("pql_filters")
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({ json: {}, stripped: "" })),
  richFilters: jsonb("rich_filters")
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({})),
});

// db_table = "webhook_logs".
export const webhookLogs = pgTable("webhook_logs", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
  webhook: uuid("webhook"),
  eventType: varchar("event_type", { length: 255 }),
  requestMethod: varchar("request_method", { length: 10 }),
  requestHeaders: text("request_headers"),
  requestBody: text("request_body"),
  responseStatus: text("response_status"),
  responseHeaders: text("response_headers"),
  responseBody: text("response_body"),
  retryCount: integer("retry_count").notNull().$defaultFn(() => 0),
});

export type Webhook = typeof webhooks.$inferSelect;
export type WebhookLog = typeof webhookLogs.$inferSelect;
