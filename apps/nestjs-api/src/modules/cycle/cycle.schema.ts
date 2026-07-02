import { doublePrecision, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { baseColumns, projectScoped } from "../../infra/database/schema/_columns";

// db_table = "cycles" (Cycle extends ProjectBaseModel). No unique constraint on name in Django
// (unlike State/Label) — the model declares none, so there is no name-uniqueness index here.
//
// NOTE on dates: Django models start_date/end_date/archived_at as DateTimeField, which Postgres
// stores as `timestamp with time zone`. We therefore use timestamp() (NOT date()) to stay faithful
// to the existing Django-managed table; using date() would produce a column type mismatch at runtime.
export const cycles = pgTable("cycles", {
  ...baseColumns,
  ...projectScoped,
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description")
    .notNull()
    .$defaultFn(() => ""),
  startDate: timestamp("start_date", { withTimezone: true, mode: "date" }),
  endDate: timestamp("end_date", { withTimezone: true, mode: "date" }),
  // Django FK `owned_by` -> DB column `owned_by_id` (CASCADE, NOT NULL). Plain uuid (no .references())
  // matching the userAudit convention, to avoid a cross-schema import cycle.
  ownedBy: uuid("owned_by_id").notNull(),
  viewProps: jsonb("view_props")
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({})),
  sortOrder: doublePrecision("sort_order")
    .notNull()
    .$defaultFn(() => 65535),
  externalSource: varchar("external_source", { length: 255 }),
  externalId: varchar("external_id", { length: 255 }),
  progressSnapshot: jsonb("progress_snapshot")
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({})),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  logoProps: jsonb("logo_props")
    .$type<Record<string, unknown>>()
    .notNull()
    .$defaultFn(() => ({})),
  // timezone: CharField(choices=pytz.common_timezones) -> varchar (choices not enumerated as pgEnum).
  timezone: varchar("timezone", { length: 255 })
    .notNull()
    .$defaultFn(() => "UTC"),
  version: integer("version")
    .notNull()
    .$defaultFn(() => 1),
});

export type Cycle = typeof cycles.$inferSelect;
export type NewCycle = typeof cycles.$inferInsert;
