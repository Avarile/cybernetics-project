import { doublePrecision, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns, projectScoped } from "../../infra/database/schema/_columns";

/**
 * db_table = "issue_activities" (IssueActivity extends ProjectBaseModel). The audit trail rows
 * written by the issue_activity engine (plane/bgtasks/issue_activities_task.py).
 *
 * Faithful port of plane/db/models/issue.py::IssueActivity. NOTE: the real Django IssueActivity
 * model has NO comment_json / comment_html / comment_stripped columns — those belong to IssueComment,
 * not IssueActivity. They are intentionally omitted here so `SELECT *` stays valid against the
 * existing Django-managed `issue_activities` table.
 */
export const issueActivities = pgTable("issue_activities", {
  ...baseColumns,
  ...projectScoped,
  // FK Issue (on_delete=DO_NOTHING, null) — audit rows survive issue deletion.
  issueId: uuid("issue_id"),
  verb: varchar("verb", { length: 255 })
    .notNull()
    .$defaultFn(() => "created"),
  field: varchar("field", { length: 255 }),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  // TextField(blank=True): NOT NULL, always written (defaults to "").
  comment: text("comment")
    .notNull()
    .$defaultFn(() => ""),
  // ArrayField(URLField(), size=10, default=list): NOT NULL text[] defaulting to [].
  attachments: text("attachments")
    .array()
    .notNull()
    .$defaultFn(() => []),
  // FK IssueComment (on_delete=DO_NOTHING, null).
  issueCommentId: uuid("issue_comment_id"),
  // FK User actor (on_delete=SET_NULL, null).
  actorId: uuid("actor_id"),
  oldIdentifier: uuid("old_identifier"),
  newIdentifier: uuid("new_identifier"),
  // FloatField(null=True) -> double precision.
  epoch: doublePrecision("epoch"),
  externalSource: varchar("external_source", { length: 255 }),
  externalId: varchar("external_id", { length: 255 }),
});

export type IssueActivityRow = typeof issueActivities.$inferSelect;
export type NewIssueActivity = typeof issueActivities.$inferInsert;
