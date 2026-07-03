import { boolean, doublePrecision, jsonb, pgTable, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "../../infra/database/schema/_columns";

// db_table = "file_assets" (FileAsset extends BaseModel). Manual polymorphism via entity_type +
// entity_identifier alongside concrete nullable FKs (see 02-data-layer-drizzle.md §3c).
export const fileAssets = pgTable("file_assets", {
  ...baseColumns,
  attributes: jsonb("attributes").$type<Record<string, unknown>>().$defaultFn(() => ({})),
  asset: varchar("asset", { length: 800 }),
  userId: uuid("user_id"),
  workspaceId: uuid("workspace_id"),
  draftIssueId: uuid("draft_issue_id"),
  projectId: uuid("project_id"),
  issueId: uuid("issue_id"),
  commentId: uuid("comment_id"),
  pageId: uuid("page_id"),
  entityType: varchar("entity_type", { length: 255 }),
  entityIdentifier: varchar("entity_identifier", { length: 255 }),
  isDeleted: boolean("is_deleted").$defaultFn(() => false),
  isArchived: boolean("is_archived").$defaultFn(() => false),
  externalId: varchar("external_id", { length: 255 }),
  externalSource: varchar("external_source", { length: 255 }),
  size: doublePrecision("size").$defaultFn(() => 0),
  isUploaded: boolean("is_uploaded").$defaultFn(() => false),
  storageMetadata: jsonb("storage_metadata").$type<Record<string, unknown> | null>(),
});

export type FileAsset = typeof fileAssets.$inferSelect;
