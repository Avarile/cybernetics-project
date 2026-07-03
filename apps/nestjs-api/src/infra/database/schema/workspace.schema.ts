import { boolean, pgTable, smallint, text, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "./_columns";

// db_table = "workspaces" / "workspace_members" (both extend BaseModel).
// NOTE (Phase 0/1): subset used by workspace/RBAC; reconcile full columns via drizzle-kit pull.
export const workspaces = pgTable("workspaces", {
  ...baseColumns,
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  ownerId: uuid("owner_id").notNull(),
  // Lite-serializer fields (WorkspaceLiteSerializer): logo_url is derived from these.
  logo: text("logo"),
  logoAssetId: uuid("logo_asset_id"),
});

export const workspaceMembers = pgTable("workspace_members", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
  memberId: uuid("member_id").notNull(),
  role: smallint("role").notNull().default(15),
  isActive: boolean("is_active").notNull().default(true),
});

export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
