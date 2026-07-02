import { boolean, pgTable, smallint, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "./_columns";

// db_table = "projects" / "project_members".
// NOTE (Phase 0/1): subset used by project/RBAC; reconcile full columns via drizzle-kit pull.
export const projects = pgTable("projects", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  identifier: varchar("identifier", { length: 12 }),
  description: varchar("description", { length: 1024 }),
});

export const projectMembers = pgTable("project_members", {
  ...baseColumns,
  projectId: uuid("project_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  memberId: uuid("member_id").notNull(),
  role: smallint("role").notNull().default(15),
  isActive: boolean("is_active").notNull().default(true),
});

export type Project = typeof projects.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
