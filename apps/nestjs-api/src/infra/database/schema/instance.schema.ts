import { boolean, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "./_columns";

// db_table = "instances" (plane/license/models/instance.py). Single-row instance registration/config
// backing the public /api/instances/ bootstrap endpoint (InstanceSerializer fields = "__all__").
export const instances = pgTable("instances", {
  ...baseColumns,
  instanceName: varchar("instance_name", { length: 255 }).notNull(),
  whitelistEmails: text("whitelist_emails"),
  instanceId: varchar("instance_id", { length: 255 }).notNull().unique(),
  currentVersion: varchar("current_version", { length: 255 }).notNull(),
  latestVersion: varchar("latest_version", { length: 255 }),
  edition: varchar("edition", { length: 255 }).$defaultFn(() => "PLANE_COMMUNITY"),
  domain: text("domain").$defaultFn(() => ""),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true, mode: "date" }).notNull(),
  namespace: varchar("namespace", { length: 255 }),
  isTelemetryEnabled: boolean("is_telemetry_enabled").notNull().default(true),
  isSupportRequired: boolean("is_support_required").notNull().default(true),
  isSetupDone: boolean("is_setup_done").notNull().default(false),
  isSignupScreenVisited: boolean("is_signup_screen_visited").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  isTest: boolean("is_test").notNull().default(false),
  isCurrentVersionDeprecated: boolean("is_current_version_deprecated").notNull().default(false),
});

export type Instance = typeof instances.$inferSelect;

// db_table = "instance_configurations" (plane/license/models/instance.py). Shared encrypted config
// store backing LLM/SMTP/OAuth/Unsplash keys; is_encrypted values use Fernet (see infra/config).
// InstanceConfiguration extends BaseModel in Django (created_by_id/updated_by_id/deleted_at present in
// the reference); the id/created_at/updated_at are hand-authored above. We add `deleted_at` for parity
// and, consistent with the app-wide DELIBERATE DIVERGENCE (see _columns.ts userAudit), do NOT mirror
// the reference's `created_by_id` / `updated_by_id` FK columns — the parity check accepts this.
export const instanceConfigurations = pgTable("instance_configurations", {
  id: uuid("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value"),
  category: varchar("category", { length: 100 }),
  isEncrypted: boolean("is_encrypted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
});

export type InstanceConfiguration = typeof instanceConfigurations.$inferSelect;
