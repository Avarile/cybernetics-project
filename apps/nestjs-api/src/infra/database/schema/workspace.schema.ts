import { boolean, jsonb, pgTable, smallint, text, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "./_columns";

// Django Workspace/WorkspaceMember JSON defaults (plane/db/models/workspace.py). Applied JS-side per
// _columns.ts convention. NOTE: the workspace variant of get_default_props DOES include
// display_properties (unlike the project variant).
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
    display_properties: {
      assignee: true,
      attachment_count: true,
      created_on: true,
      due_date: true,
      estimate: true,
      key: true,
      labels: true,
      link: true,
      priority: true,
      start_date: true,
      state: true,
      sub_issue_count: true,
      updated_on: true,
    },
  };
}

function getIssueProps(): Record<string, unknown> {
  return { subscribed: true, assigned: true, created: true, all_issues: true };
}

// get_random_color(): "#" + 6 random hex digits (plane/utils/color.py).
function getRandomColor(): string {
  return "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
}

// db_table = "workspaces" / "workspace_members" (both extend BaseModel). Reconciled to full parity.
export const workspaces = pgTable("workspaces", {
  ...baseColumns,
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  ownerId: uuid("owner_id").notNull(),
  // Lite-serializer fields (WorkspaceLiteSerializer): logo_url is derived from these.
  logo: text("logo"),
  logoAssetId: uuid("logo_asset_id"),
  organizationSize: varchar("organization_size", { length: 20 }),
  timezone: varchar("timezone", { length: 255 })
    .notNull()
    .$defaultFn(() => "UTC"),
  backgroundColor: varchar("background_color", { length: 255 }).notNull().$defaultFn(getRandomColor),
});

export const workspaceMembers = pgTable("workspace_members", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
  memberId: uuid("member_id").notNull(),
  role: smallint("role").notNull().default(15),
  companyRole: text("company_role"),
  viewProps: jsonb("view_props").$type<Record<string, unknown>>().notNull().$defaultFn(getDefaultProps),
  defaultProps: jsonb("default_props").$type<Record<string, unknown>>().notNull().$defaultFn(getDefaultProps),
  issueProps: jsonb("issue_props").$type<Record<string, unknown>>().notNull().$defaultFn(getIssueProps),
  isActive: boolean("is_active").notNull().default(true),
  gettingStartedChecklist: jsonb("getting_started_checklist")
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({})),
  tips: jsonb("tips")
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({})),
  exploredFeatures: jsonb("explored_features")
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({})),
});

export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
