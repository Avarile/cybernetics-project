import { boolean, pgTable, smallint, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns } from "../../infra/database/schema/_columns";

// db_table = "workspace_member_invites" (plane/db/models/workspace.py::WorkspaceMemberInvite, extends
// BaseModel). Pending invite to join a workspace by email; accepted/responded_at are stamped when the
// invite is used (sign-up + accept-invite flows). token is app-generated (no DB default).
export const workspaceMemberInvites = pgTable("workspace_member_invites", {
  ...baseColumns,
  workspaceId: uuid("workspace_id").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  accepted: boolean("accepted").notNull().default(false),
  token: varchar("token", { length: 255 }).notNull(),
  message: text("message"),
  respondedAt: timestamp("responded_at", { withTimezone: true, mode: "date" }),
  role: smallint("role").notNull().default(5),
});

export type WorkspaceMemberInvite = typeof workspaceMemberInvites.$inferSelect;
