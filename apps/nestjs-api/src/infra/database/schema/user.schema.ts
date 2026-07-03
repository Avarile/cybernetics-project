import { boolean, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

// db_table = "users". Extends AbstractBaseUser + PermissionsMixin (NOT BaseModel): UUID PK + own
// created_at/updated_at, but no created_by/updated_by/deleted_at.
//
// NOTE (Phase 0/1): hand-authored subset of columns actually used by auth/RBAC. Reconcile to full
// column parity via `drizzle-kit pull` against a Django-migrated DB (drift gate: 02 §5).
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: varchar("email", { length: 255 }),
  password: varchar("password", { length: 128 }),
  username: varchar("username", { length: 255 }),
  isActive: boolean("is_active").notNull().default(true),
  isSuperuser: boolean("is_superuser").notNull().default(false),
  isBot: boolean("is_bot").notNull().default(false),
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  displayName: varchar("display_name", { length: 255 }),
  avatar: varchar("avatar", { length: 800 }),
  avatarAssetId: uuid("avatar_asset_id"),
  userTimezone: varchar("user_timezone", { length: 255 }),
  lastLogin: timestamp("last_login", { withTimezone: true, mode: "date" }),
  lastLogoutTime: timestamp("last_logout_time", { withTimezone: true, mode: "date" }),
  lastLogoutIp: varchar("last_logout_ip", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export type User = typeof users.$inferSelect;
