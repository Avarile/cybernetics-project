import { boolean, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

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
  // --- Reconciled to full Django parity (plane/db/models/user.py). JS-side defaults mirror the
  //     Python field defaults (Django CharField/TextField blank -> "" ; DateTimeField(auto_now_add
  //     / default=timezone.now) -> new Date()). The DB columns carry no default (per _columns.ts).
  mobileNumber: varchar("mobile_number", { length: 255 }),
  coverImage: varchar("cover_image", { length: 800 }),
  coverImageAssetId: uuid("cover_image_asset_id"),
  createdLocation: varchar("created_location", { length: 255 }).notNull().$defaultFn(() => ""),
  lastLocation: varchar("last_location", { length: 255 }).notNull().$defaultFn(() => ""),
  dateJoined: timestamp("date_joined", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  isManaged: boolean("is_managed").notNull().default(false),
  isPasswordExpired: boolean("is_password_expired").notNull().default(false),
  isStaff: boolean("is_staff").notNull().default(false),
  isEmailVerified: boolean("is_email_verified").notNull().default(false),
  isPasswordAutoset: boolean("is_password_autoset").notNull().default(false),
  isPasswordResetRequired: boolean("is_password_reset_required").notNull().default(false),
  isEmailValid: boolean("is_email_valid").notNull().default(false),
  token: varchar("token", { length: 64 }).notNull().$defaultFn(() => ""),
  tokenUpdatedAt: timestamp("token_updated_at", { withTimezone: true, mode: "date" }),
  lastActive: timestamp("last_active", { withTimezone: true, mode: "date" }).$defaultFn(() => new Date()),
  lastLoginTime: timestamp("last_login_time", { withTimezone: true, mode: "date" }),
  lastLoginIp: varchar("last_login_ip", { length: 255 }).notNull().$defaultFn(() => ""),
  lastLoginMedium: varchar("last_login_medium", { length: 20 }).notNull().$defaultFn(() => "email"),
  lastLoginUagent: text("last_login_uagent").notNull().$defaultFn(() => ""),
  botType: varchar("bot_type", { length: 30 }),
  maskedAt: timestamp("masked_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export type User = typeof users.$inferSelect;
