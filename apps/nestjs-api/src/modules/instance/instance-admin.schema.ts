import { boolean, integer, pgTable, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "../../infra/database/schema/_columns";

// db_table = "instance_admins" (plane/license/models/instance.py::InstanceAdmin, extends BaseModel).
// role default 20 (Admin), is_verified default false.
export const instanceAdmins = pgTable("instance_admins", {
  ...baseColumns,
  userId: uuid("user_id"),
  instanceId: uuid("instance_id").notNull(),
  role: integer("role").notNull().default(20),
  isVerified: boolean("is_verified").notNull().default(false),
});

export type InstanceAdmin = typeof instanceAdmins.$inferSelect;
