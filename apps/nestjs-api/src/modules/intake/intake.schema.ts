import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns, projectScoped } from "../../infra/database/schema/_columns";

// SourceType (Django TextChoices) is a plain varchar column, modelled as a TS union (never pgEnum) —
// see developments/backend/current_design/02-data-layer-drizzle.md ground-truth #2.
export const INTAKE_SOURCE = ["IN_APP"] as const;
export type IntakeSource = (typeof INTAKE_SOURCE)[number];

// IntakeIssueStatus (Django IntegerChoices) → an integer column. Values kept identical to Django.
export const INTAKE_ISSUE_STATUS = {
  PENDING: -2,
  REJECTED: -1,
  SNOOZED: 0,
  ACCEPTED: 1,
  DUPLICATE: 2,
} as const;
export type IntakeIssueStatus = (typeof INTAKE_ISSUE_STATUS)[keyof typeof INTAKE_ISSUE_STATUS];
export const INTAKE_ISSUE_STATUS_VALUES = Object.values(INTAKE_ISSUE_STATUS) as IntakeIssueStatus[];

// db_table = "intakes" (Intake extends ProjectBaseModel). view_props/logo_props default to {} (dict).
export const intakes = pgTable(
  "intakes",
  {
    ...baseColumns,
    ...projectScoped,
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").$defaultFn(() => ""),
    isDefault: boolean("is_default").$defaultFn(() => false),
    viewProps: jsonb("view_props").$type<Record<string, unknown>>().$defaultFn(() => ({})),
    logoProps: jsonb("logo_props").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  },
  (t) => [
    uniqueIndex("intake_unique_name_project_when_deleted_at_null")
      .on(t.name, t.projectId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// db_table = "intake_issues" (IntakeIssue extends ProjectBaseModel). Links intake + issue + status/source.
// status default -2 (PENDING); source default "IN_APP"; snoozed_till is a nullable timestamp;
// duplicate_to is a nullable FK to issues (SET_NULL in Django → app-level; plain uuid column here).
export const intakeIssues = pgTable("intake_issues", {
  ...baseColumns,
  ...projectScoped,
  intakeId: uuid("intake_id").notNull(),
  issueId: uuid("issue_id").notNull(),
  status: integer("status")
    .$type<IntakeIssueStatus>()
    .$defaultFn(() => INTAKE_ISSUE_STATUS.PENDING),
  snoozedTill: timestamp("snoozed_till", { withTimezone: true, mode: "date" }),
  duplicateToId: uuid("duplicate_to_id"),
  source: varchar("source", { length: 255 }).$defaultFn(() => "IN_APP"),
  sourceEmail: text("source_email"),
  externalSource: varchar("external_source", { length: 255 }),
  externalId: varchar("external_id", { length: 255 }),
  extra: jsonb("extra").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  trackableAnchor: varchar("trackable_anchor", { length: 255 }),
});

export type Intake = typeof intakes.$inferSelect;
export type NewIntake = typeof intakes.$inferInsert;
export type IntakeIssue = typeof intakeIssues.$inferSelect;
export type NewIntakeIssue = typeof intakeIssues.$inferInsert;
