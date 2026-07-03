import { boolean, jsonb, pgTable, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns, workspaceScoped } from "../../infra/database/schema/_columns";

// db_table = "deploy_boards" (DeployBoard extends WorkspaceBaseModel). The anchor token grants
// anonymous access to a published project board.
export const deployBoards = pgTable("deploy_boards", {
  ...baseColumns,
  ...workspaceScoped,
  entityIdentifier: uuid("entity_identifier"),
  entityName: varchar("entity_name", { length: 30 }),
  anchor: varchar("anchor", { length: 255 }).notNull(),
  isCommentsEnabled: boolean("is_comments_enabled").$defaultFn(() => false),
  isReactionsEnabled: boolean("is_reactions_enabled").$defaultFn(() => false),
  intakeId: uuid("intake_id"),
  isVotesEnabled: boolean("is_votes_enabled").$defaultFn(() => false),
  viewProps: jsonb("view_props").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  isActivityEnabled: boolean("is_activity_enabled").$defaultFn(() => true),
  isDisabled: boolean("is_disabled").$defaultFn(() => false),
});

export type DeployBoard = typeof deployBoards.$inferSelect;
