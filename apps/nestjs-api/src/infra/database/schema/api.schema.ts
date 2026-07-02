import { boolean, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "./_columns";

// db_table = "api_tokens" (APIToken extends BaseModel).
// NOTE (Phase 0/1): subset used by ApiKeyGuard; reconcile full columns via drizzle-kit pull.
export const apiTokens = pgTable("api_tokens", {
  ...baseColumns,
  token: varchar("token", { length: 255 }).notNull(),
  label: varchar("label", { length: 255 }),
  description: varchar("description", { length: 255 }),
  userId: uuid("user_id").notNull(),
  workspaceId: uuid("workspace_id"),
  isActive: boolean("is_active").notNull().default(true),
  lastUsed: timestamp("last_used", { withTimezone: true, mode: "date" }),
  expiredAt: timestamp("expired_at", { withTimezone: true, mode: "date" }),
});

export type ApiToken = typeof apiTokens.$inferSelect;
