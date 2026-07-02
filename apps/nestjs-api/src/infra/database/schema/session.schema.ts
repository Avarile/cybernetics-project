import { jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

// db_table = "sessions". Custom AbstractBaseSession (plane/db/models/session.py).
// The cookie value IS the raw unsigned session_key (PK). user_id is denormalized -> reads need no crypto.
export const sessions = pgTable("sessions", {
  sessionKey: varchar("session_key", { length: 128 }).primaryKey(),
  sessionData: text("session_data").notNull(),
  expireDate: timestamp("expire_date", { withTimezone: true, mode: "date" }).notNull(),
  deviceInfo: jsonb("device_info").$type<Record<string, unknown> | null>(),
  userId: varchar("user_id", { length: 50 }),
});

export type SessionRow = typeof sessions.$inferSelect;
