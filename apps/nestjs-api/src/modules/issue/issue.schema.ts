import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { baseColumns, projectScoped } from "../../infra/database/schema/_columns";
import { bytea, ISSUE_PRIORITY, type IssuePriority } from "../../infra/database/schema/_types";

// db_table = "issues" (Issue extends ProjectBaseModel). Rich-text quad: description_json/html/stripped/binary.
export const issues = pgTable("issues", {
  ...baseColumns,
  ...projectScoped,
  parentId: uuid("parent_id").references((): AnyPgColumn => issues.id, { onDelete: "cascade" }),
  stateId: uuid("state_id"),
  estimatePointId: uuid("estimate_point_id"),
  point: integer("point"),
  name: varchar("name", { length: 255 }).notNull(),
  descriptionJson: jsonb("description_json").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  descriptionHtml: text("description_html").$defaultFn(() => "<p></p>"),
  descriptionStripped: text("description_stripped"),
  descriptionBinary: bytea("description_binary"),
  priority: varchar("priority", { length: 30 }).$type<IssuePriority>().$defaultFn(() => "none"),
  startDate: date("start_date", { mode: "string" }),
  targetDate: date("target_date", { mode: "string" }),
  sequenceId: integer("sequence_id").$defaultFn(() => 1),
  sortOrder: doublePrecision("sort_order").$defaultFn(() => 65535),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  archivedAt: date("archived_at", { mode: "string" }),
  isDraft: boolean("is_draft").$defaultFn(() => false),
  externalSource: varchar("external_source", { length: 255 }),
  externalId: varchar("external_id", { length: 255 }),
  typeId: uuid("type_id"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: "date" }),
});

// db_table = "issue_sequences" (per-project monotonically increasing sequence).
export const issueSequences = pgTable("issue_sequences", {
  ...baseColumns,
  ...projectScoped,
  issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
  sequence: integer("sequence").notNull().$defaultFn(() => 1),
  deleted: boolean("deleted").notNull().default(false),
});

// db_table = "issue_assignees" (M2M through Issue<->User).
export const issueAssignees = pgTable(
  "issue_assignees",
  {
    ...baseColumns,
    ...projectScoped,
    issueId: uuid("issue_id").notNull(),
    assigneeId: uuid("assignee_id").notNull(),
  },
  (t) => [
    uniqueIndex("issue_assignee_unique_issue_assignee_when_deleted_at_null")
      .on(t.issueId, t.assigneeId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// db_table = "issue_labels" (M2M through Issue<->Label).
export const issueLabels = pgTable("issue_labels", {
  ...baseColumns,
  ...projectScoped,
  issueId: uuid("issue_id").notNull(),
  labelId: uuid("label_id").notNull(),
});

export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;
export type { IssuePriority };
