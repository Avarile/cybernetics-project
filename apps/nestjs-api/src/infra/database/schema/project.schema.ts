import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./_columns";

// Django Project/ProjectMember JSON defaults (plane/db/models/project.py get_default_props /
// get_default_preferences). Applied JS-side per _columns.ts convention. NOTE: the project variant of
// get_default_props has NO display_properties (unlike the workspace variant).
function getDefaultProps(): Record<string, unknown> {
  return {
    filters: {
      priority: null,
      state: null,
      state_group: null,
      assignees: null,
      created_by: null,
      labels: null,
      start_date: null,
      target_date: null,
      subscriber: null,
    },
    display_filters: {
      group_by: null,
      order_by: "-created_at",
      type: null,
      sub_issue: true,
      show_empty_groups: true,
      layout: "list",
      calendar_date_range: "",
    },
  };
}

function getDefaultPreferences(): Record<string, unknown> {
  return { pages: { block_display: true }, navigation: { default_tab: "work_items", hide_in_more_menu: [] } };
}

// db_table = "projects" / "project_members". Reconciled to full column parity (plane/db/models/project.py).
export const projects = pgTable("projects", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  identifier: varchar("identifier", { length: 12 }),
  description: varchar("description", { length: 1024 }),
  descriptionText: jsonb("description_text").$type<Record<string, unknown>>(),
  descriptionHtml: jsonb("description_html").$type<Record<string, unknown>>(),
  network: smallint("network").notNull().default(2),
  defaultAssigneeId: uuid("default_assignee_id"),
  projectLeadId: uuid("project_lead_id"),
  emoji: varchar("emoji", { length: 255 }),
  iconProp: jsonb("icon_prop").$type<Record<string, unknown>>(),
  moduleView: boolean("module_view").notNull().default(false),
  cycleView: boolean("cycle_view").notNull().default(false),
  issueViewsView: boolean("issue_views_view").notNull().default(false),
  pageView: boolean("page_view").notNull().default(true),
  intakeView: boolean("intake_view").notNull().default(false),
  isTimeTrackingEnabled: boolean("is_time_tracking_enabled").notNull().default(false),
  isIssueTypeEnabled: boolean("is_issue_type_enabled").notNull().default(false),
  guestViewAllFeatures: boolean("guest_view_all_features").notNull().default(false),
  // Lite-serializer fields (ProjectLiteSerializer): cover image + logo props.
  coverImage: text("cover_image"),
  coverImageAssetId: uuid("cover_image_asset_id"),
  estimateId: uuid("estimate_id"),
  archiveIn: integer("archive_in").notNull().default(0),
  closeIn: integer("close_in").notNull().default(0),
  autoReminderDays: integer("auto_reminder_days").notNull().default(0),
  logoProps: jsonb("logo_props").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  defaultStateId: uuid("default_state_id"),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  timezone: varchar("timezone", { length: 255 })
    .notNull()
    .$defaultFn(() => "UTC"),
  externalSource: varchar("external_source", { length: 255 }),
  externalId: varchar("external_id", { length: 255 }),
});

export const projectMembers = pgTable("project_members", {
  ...baseColumns,
  projectId: uuid("project_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  memberId: uuid("member_id").notNull(),
  comment: text("comment"),
  role: smallint("role").notNull().default(15),
  viewProps: jsonb("view_props").$type<Record<string, unknown>>().notNull().$defaultFn(getDefaultProps),
  defaultProps: jsonb("default_props").$type<Record<string, unknown>>().notNull().$defaultFn(getDefaultProps),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().$defaultFn(getDefaultPreferences),
  sortOrder: doublePrecision("sort_order")
    .notNull()
    .$defaultFn(() => 65535),
  isActive: boolean("is_active").notNull().default(true),
  source: varchar("source", { length: 20 })
    .notNull()
    .$defaultFn(() => "manual"),
});

export type Project = typeof projects.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
