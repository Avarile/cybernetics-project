import { boolean, integer, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "../../infra/database/schema/_columns";

// db_table = "instance_admins" (plane/license/models/instance.py::InstanceAdmin, extends BaseModel).
// role default 20 (Admin), is_verified default false.
// unique_together = ("instance", "user") in the Django Meta — enforced here as a composite unique index.
export const instanceAdmins = pgTable(
  "instance_admins",
  {
    ...baseColumns,
    userId: uuid("user_id"),
    instanceId: uuid("instance_id").notNull(),
    role: integer("role").notNull().default(20),
    isVerified: boolean("is_verified").notNull().default(false),
  },
  (t) => [uniqueIndex("instance_admins_instance_id_user_id_key").on(t.instanceId, t.userId)]
);

export type InstanceAdmin = typeof instanceAdmins.$inferSelect;
