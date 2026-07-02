import { customType } from "drizzle-orm/pg-core";

/** BinaryField -> bytea (e.g. Issue.description_binary holds the Yjs doc written by apps/live). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// Django CharField(choices=...) columns are plain varchar in the DB — model values as TS unions,
// never pgEnum (see developments/backend/current_design/02-data-layer-drizzle.md ground-truth #2).
export const ISSUE_PRIORITY = ["urgent", "high", "medium", "low", "none"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITY)[number];

export const ROLE_VALUES = [20, 15, 5] as const; // ADMIN, MEMBER, GUEST

export const ASSET_ENTITY_TYPE = [
  "ISSUE_ATTACHMENT",
  "ISSUE_DESCRIPTION",
  "COMMENT_DESCRIPTION",
  "PAGE_DESCRIPTION",
  "USER_COVER",
  "USER_AVATAR",
  "WORKSPACE_LOGO",
  "PROJECT_COVER",
  "DRAFT_ISSUE_ATTACHMENT",
  "DRAFT_ISSUE_DESCRIPTION",
] as const;
export type AssetEntityType = (typeof ASSET_ENTITY_TYPE)[number];
