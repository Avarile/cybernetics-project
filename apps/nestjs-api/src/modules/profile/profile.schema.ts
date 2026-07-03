import { randomUUID } from "crypto";
import { boolean, jsonb, pgTable, smallint, text, uuid, varchar } from "drizzle-orm/pg-core";
import { timeAudit } from "../../infra/database/schema/_columns";

// Django default functions (plane/db/models/user.py), reproduced verbatim.
const onboarding = () => ({
  profile_complete: false,
  workspace_create: false,
  workspace_invite: false,
  workspace_join: false,
});
const mobileOnboarding = () => ({
  profile_complete: false,
  workspace_create: false,
  workspace_join: false,
});
const productTour = () => ({ work_items: false, cycles: false, modules: false, intake: false, pages: false });

// db_table = "profiles" (plane/db/models/user.py::Profile). One row per user.
//
// Profile extends TimeAuditModel only (created_at/updated_at) -- NOT BaseModel: the reference DB has
// no created_by_id/updated_by_id/deleted_at on this table (verified via `\d profiles` against the
// migrated Plane DB and against the Django model source). Its own explicit UUID `id` field mirrors
// BaseModel's id field without pulling in the audit/soft-delete mixins.
export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  ...timeAudit,
  userId: uuid("user_id").notNull().unique(),
  theme: jsonb("theme")
    .$defaultFn(() => ({}))
    .notNull(),
  isAppRailDocked: boolean("is_app_rail_docked").notNull().default(true),
  isTourCompleted: boolean("is_tour_completed").notNull().default(false),
  onboardingStep: jsonb("onboarding_step").$defaultFn(onboarding).notNull(),
  useCase: text("use_case"),
  role: varchar("role", { length: 300 }),
  isOnboarded: boolean("is_onboarded").notNull().default(false),
  lastWorkspaceId: uuid("last_workspace_id"),
  billingAddressCountry: varchar("billing_address_country", { length: 255 }).notNull().default("INDIA"),
  billingAddress: jsonb("billing_address"),
  hasBillingAddress: boolean("has_billing_address").notNull().default(false),
  companyName: varchar("company_name", { length: 255 }).notNull().default(""),
  notificationViewMode: varchar("notification_view_mode", { length: 255 }).notNull().default("full"),
  isSmoothCursorEnabled: boolean("is_smooth_cursor_enabled").notNull().default(false),
  isMobileOnboarded: boolean("is_mobile_onboarded").notNull().default(false),
  mobileOnboardingStep: jsonb("mobile_onboarding_step").$defaultFn(mobileOnboarding).notNull(),
  mobileTimezoneAutoSet: boolean("mobile_timezone_auto_set").notNull().default(false),
  language: varchar("language", { length: 255 }).notNull().default("en"),
  // PositiveSmallIntegerField in Django (reference column type is smallint).
  startOfTheWeek: smallint("start_of_the_week").notNull().default(0),
  goals: jsonb("goals")
    .$defaultFn(() => ({}))
    .notNull(),
  backgroundColor: varchar("background_color", { length: 255 }).notNull().default("#3f76ff"),
  isNavigationTourCompleted: boolean("is_navigation_tour_completed").notNull().default(false),
  hasMarketingEmailConsent: boolean("has_marketing_email_consent").notNull().default(false),
  isSubscribedToChangelog: boolean("is_subscribed_to_changelog").notNull().default(false),
  productTour: jsonb("product_tour").$defaultFn(productTour).notNull(),
});

export type Profile = typeof profiles.$inferSelect;
