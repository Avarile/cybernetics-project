import { boolean, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns, projectScoped } from "../../infra/database/schema/_columns";

// db_table = "notifications" (Notification extends BaseModel).
export const notifications = pgTable("notifications", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id"),
  data: jsonb("data").$type<Record<string, unknown> | null>(),
  entityIdentifier: uuid("entity_identifier"),
  entityName: varchar("entity_name", { length: 255 }).notNull(),
  title: text("title").notNull().$defaultFn(() => ""),
  message: jsonb("message").$type<Record<string, unknown> | null>(),
  messageHtml: text("message_html").$defaultFn(() => "<p></p>"),
  messageStripped: text("message_stripped"),
  sender: varchar("sender", { length: 255 }).notNull(),
  triggeredById: uuid("triggered_by_id"),
  receiverId: uuid("receiver_id").notNull(),
  readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
  snoozedTill: timestamp("snoozed_till", { withTimezone: true, mode: "date" }),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
});

// db_table = "user_notification_preferences".
export const userNotificationPreferences = pgTable("user_notification_preferences", {
  ...baseColumns,
  userId: uuid("user_id").notNull(),
  workspaceId: uuid("workspace_id"),
  projectId: uuid("project_id"),
  propertyChange: boolean("property_change").notNull().$defaultFn(() => true),
  stateChange: boolean("state_change").notNull().$defaultFn(() => true),
  comment: boolean("comment").notNull().$defaultFn(() => true),
  mention: boolean("mention").notNull().$defaultFn(() => true),
  issueCompleted: boolean("issue_completed").notNull().$defaultFn(() => true),
});

// db_table = "email_notification_logs".
export const emailNotificationLogs = pgTable("email_notification_logs", {
  ...baseColumns,
  receiverId: uuid("receiver_id").notNull(),
  triggeredById: uuid("triggered_by_id"),
  entityIdentifier: uuid("entity_identifier"),
  entityName: varchar("entity_name", { length: 255 }).notNull(),
  data: jsonb("data").$type<Record<string, unknown> | null>(),
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
  entity: varchar("entity", { length: 200 }).notNull(),
  oldValue: varchar("old_value", { length: 300 }),
  newValue: varchar("new_value", { length: 300 }),
});

// db_table = "issue_subscribers" (IssueSubscriber extends ProjectBaseModel) — needed for notification fan-out.
export const issueSubscribers = pgTable("issue_subscribers", {
  ...baseColumns,
  ...projectScoped,
  issueId: uuid("issue_id").notNull(),
  subscriberId: uuid("subscriber_id").notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type UserNotificationPreference = typeof userNotificationPreferences.$inferSelect;
export type EmailNotificationLog = typeof emailNotificationLogs.$inferSelect;
