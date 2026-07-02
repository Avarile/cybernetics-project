import { boolean, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

// db_table = "instance_configurations" (plane/license/models/instance.py). Shared encrypted config
// store backing LLM/SMTP/OAuth/Unsplash keys; is_encrypted values use Fernet (see infra/config).
export const instanceConfigurations = pgTable("instance_configurations", {
  id: uuid("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull(),
  value: text("value"),
  category: varchar("category", { length: 100 }),
  isEncrypted: boolean("is_encrypted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export type InstanceConfiguration = typeof instanceConfigurations.$inferSelect;
