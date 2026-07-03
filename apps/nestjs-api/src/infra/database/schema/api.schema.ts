import { boolean, pgTable, smallint, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "./_columns";

// db_table = "api_tokens" (APIToken extends BaseModel). Reconciled to full parity (plane/db/models/api.py).
export const apiTokens = pgTable("api_tokens", {
  ...baseColumns,
  token: varchar("token", { length: 255 }).notNull(),
  label: varchar("label", { length: 255 }),
  description: varchar("description", { length: 255 }),
  userId: uuid("user_id").notNull(),
  // user_type: PositiveSmallIntegerField choices ((0,"Human"),(1,"Bot")), default 0.
  userType: smallint("user_type").notNull().default(0),
  workspaceId: uuid("workspace_id"),
  isActive: boolean("is_active").notNull().default(true),
  lastUsed: timestamp("last_used", { withTimezone: true, mode: "date" }),
  expiredAt: timestamp("expired_at", { withTimezone: true, mode: "date" }),
  isService: boolean("is_service").notNull().default(false),
  allowedRateLimit: varchar("allowed_rate_limit", { length: 255 })
    .notNull()
    .$defaultFn(() => "60/min"),
});

export type ApiToken = typeof apiTokens.$inferSelect;
