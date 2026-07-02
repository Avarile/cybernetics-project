import { sql } from "drizzle-orm";
import { boolean, doublePrecision, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns, projectScoped } from "../../infra/database/schema/_columns";

// db_table = "states" (State extends ProjectBaseModel). group is a varchar (choices), not pgEnum.
export const STATE_GROUP = ["backlog", "unstarted", "started", "completed", "cancelled", "triage"] as const;
export type StateGroup = (typeof STATE_GROUP)[number];

export const states = pgTable(
  "states",
  {
    ...baseColumns,
    ...projectScoped,
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").$defaultFn(() => ""),
    color: varchar("color", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }),
    sequence: doublePrecision("sequence").$defaultFn(() => 65535),
    group: varchar("group", { length: 20 }).$type<StateGroup>().$defaultFn(() => "backlog"),
    isTriage: boolean("is_triage").$defaultFn(() => false),
    default: boolean("default").$defaultFn(() => false),
    externalSource: varchar("external_source", { length: 255 }),
    externalId: varchar("external_id", { length: 255 }),
  },
  (t) => [
    uniqueIndex("state_unique_name_project_when_deleted_at_null")
      .on(t.name, t.projectId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type State = typeof states.$inferSelect;
export type NewState = typeof states.$inferInsert;
