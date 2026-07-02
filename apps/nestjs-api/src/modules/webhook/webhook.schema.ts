import { boolean, integer, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "../../infra/database/schema/_columns";

// db_table = "webhooks" (Webhook extends BaseModel, workspace-scoped).
export const webhooks = pgTable("webhooks", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
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
