import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns, projectScoped } from "../../infra/database/schema/_columns";

// db_table = "estimates" (Estimate extends ProjectBaseModel).
// type is a varchar backed by EstimateType choices (categories | points), NOT a pgEnum.
export const ESTIMATE_TYPE = ["categories", "points"] as const;
export type EstimateType = (typeof ESTIMATE_TYPE)[number];

export const estimates = pgTable(
  "estimates",
  {
    ...baseColumns,
    ...projectScoped,
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").$defaultFn(() => ""),
    type: varchar("type", { length: 255 })
      .$type<EstimateType>()
      .$defaultFn(() => "categories"),
    lastUsed: boolean("last_used").$defaultFn(() => false),
    externalSource: varchar("external_source", { length: 255 }),
    externalId: varchar("external_id", { length: 255 }),
  },
  (t) => [
    uniqueIndex("estimate_unique_name_project_when_deleted_at_null")
      .on(t.name, t.projectId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// db_table = "estimate_points" (EstimatePoint extends ProjectBaseModel).
export const estimatePoints = pgTable("estimate_points", {
  ...baseColumns,
  ...projectScoped,
  estimateId: uuid("estimate_id")
    .notNull()
    .references(() => estimates.id, { onDelete: "cascade" }),
  key: integer("key").$defaultFn(() => 0),
  description: text("description").$defaultFn(() => ""),
  value: varchar("value", { length: 255 }).notNull(),
  externalSource: varchar("external_source", { length: 255 }),
  externalId: varchar("external_id", { length: 255 }),
});

export type Estimate = typeof estimates.$inferSelect;
export type NewEstimate = typeof estimates.$inferInsert;
export type EstimatePoint = typeof estimatePoints.$inferSelect;
export type NewEstimatePoint = typeof estimatePoints.$inferInsert;
