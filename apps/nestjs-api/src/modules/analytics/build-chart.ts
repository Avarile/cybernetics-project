import { sql, type SQL } from "drizzle-orm";
import type { Database } from "../../infra/database/drizzle.module";

/**
 * Port of plane/utils/build_chart.py — build_analytics_chart + the simple/grouped response builders
 * and process_grouped_data. Raw parameterised SQL over `issues i`; the caller supplies the WHERE
 * predicates (base_filters + project/cycle/module + date range). COUNT(DISTINCT i.id) mirrors
 * Django's Count("id", distinct=True), which de-dups the row fan-out from the M2M joins.
 */

// x_axis_mapper — the valid x_axis / group_by field names (uppercase).
export const X_AXIS_FIELDS = [
  "STATES",
  "STATE_GROUPS",
  "LABELS",
  "ASSIGNEES",
  "ESTIMATE_POINTS",
  "CYCLES",
  "MODULES",
  "PRIORITY",
  "START_DATE",
  "TARGET_DATE",
  "CREATED_AT",
  "COMPLETED_AT",
  "CREATED_BY",
] as const;
export type XAxisField = (typeof X_AXIS_FIELDS)[number];
export const isXAxis = (v: unknown): v is XAxisField => typeof v === "string" && (X_AXIS_FIELDS as readonly string[]).includes(v);

interface Resolved {
  keyExpr: SQL;
  nameExpr: SQL;
  joins: Array<[string, SQL]>; // [alias, join SQL] — deduped by alias across x + group
  extra: SQL[]; // additional_filter applied as WHERE (matches Django .filter() on the join)
}

function resolve(field: XAxisField): Resolved {
  switch (field) {
    case "STATES":
      return { keyExpr: sql`i.state_id::text`, nameExpr: sql`s.name`, joins: [["s", sql`LEFT JOIN states s ON s.id = i.state_id`]], extra: [] };
    case "STATE_GROUPS":
      return { keyExpr: sql`s."group"`, nameExpr: sql`s."group"`, joins: [["s", sql`LEFT JOIN states s ON s.id = i.state_id`]], extra: [] };
    case "LABELS":
      return {
        keyExpr: sql`il.label_id::text`,
        nameExpr: sql`l.name`,
        joins: [["il", sql`LEFT JOIN issue_labels il ON il.issue_id = i.id`], ["l", sql`LEFT JOIN labels l ON l.id = il.label_id`]],
        extra: [sql`il.deleted_at IS NULL`],
      };
    case "ASSIGNEES":
      return {
        keyExpr: sql`ia.assignee_id::text`,
        nameExpr: sql`ua.display_name`,
        joins: [["ia", sql`LEFT JOIN issue_assignees ia ON ia.issue_id = i.id`], ["ua", sql`LEFT JOIN users ua ON ua.id = ia.assignee_id`]],
        extra: [sql`ia.deleted_at IS NULL`],
      };
    case "ESTIMATE_POINTS":
      // key stays numeric (estimate_point__key is an int) so key 0 is Python-falsy → "None", like Django.
      return { keyExpr: sql`ep.key`, nameExpr: sql`ep.value`, joins: [["ep", sql`LEFT JOIN estimate_points ep ON ep.id = i.estimate_point_id`]], extra: [] };
    case "CYCLES":
      return {
        keyExpr: sql`ci.cycle_id::text`,
        nameExpr: sql`cy.name`,
        joins: [["ci", sql`LEFT JOIN cycle_issues ci ON ci.issue_id = i.id`], ["cy", sql`LEFT JOIN cycles cy ON cy.id = ci.cycle_id`]],
        extra: [sql`ci.deleted_at IS NULL`],
      };
    case "MODULES":
      return {
        keyExpr: sql`mi.module_id::text`,
        nameExpr: sql`mo.name`,
        joins: [["mi", sql`LEFT JOIN module_issues mi ON mi.issue_id = i.id`], ["mo", sql`LEFT JOIN modules mo ON mo.id = mi.module_id`]],
        extra: [sql`mi.deleted_at IS NULL`],
      };
    case "PRIORITY":
      return { keyExpr: sql`i.priority`, nameExpr: sql`i.priority`, joins: [], extra: [] };
    case "START_DATE":
      return { keyExpr: sql`i.start_date::text`, nameExpr: sql`i.start_date::text`, joins: [], extra: [] };
    case "TARGET_DATE":
      return { keyExpr: sql`i.target_date::text`, nameExpr: sql`i.target_date::text`, joins: [], extra: [] };
    case "CREATED_AT":
      return { keyExpr: sql`i.created_at::date::text`, nameExpr: sql`i.created_at::date::text`, joins: [], extra: [] };
    case "COMPLETED_AT":
      return { keyExpr: sql`i.completed_at::date::text`, nameExpr: sql`i.completed_at::date::text`, joins: [], extra: [] };
    case "CREATED_BY":
      return { keyExpr: sql`i.created_by::text`, nameExpr: sql`ubc.display_name`, joins: [["ubc", sql`LEFT JOIN users ubc ON ubc.id = i.created_by`]], extra: [] };
  }
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;

async function runRows(db: Database, query: SQL): Promise<Row[]> {
  return rowsOf(await db.execute(query));
}

function joinSql(pairs: Array<[string, SQL]>): SQL {
  const dedup = new Map<string, SQL>();
  for (const [alias, j] of pairs) if (!dedup.has(alias)) dedup.set(alias, j);
  return dedup.size ? sql.join([...dedup.values()], sql` `) : sql``;
}

interface SimpleItem {
  key: unknown;
  name: unknown;
  count: number;
}
interface GroupedResult {
  data: Array<Record<string, unknown>>;
  schema: Record<string, string>;
}

/** build_analytics_chart(queryset, x_axis, group_by): {data, schema}. */
export async function buildAnalyticsChart(
  db: Database,
  where: SQL[],
  xAxis: string,
  groupBy?: string | null,
): Promise<{ data: SimpleItem[] | GroupedResult["data"]; schema: Record<string, string> }> {
  if (!isXAxis(xAxis)) throw new Error(`Invalid x_axis field: ${xAxis}`);
  if (groupBy && !isXAxis(groupBy)) throw new Error(`Invalid group_by field: ${groupBy}`);

  const x = resolve(xAxis);
  const g = groupBy ? resolve(groupBy as XAxisField) : null;
  const conds = [...where, ...x.extra, ...(g?.extra ?? [])];
  const from = joinSql([...x.joins, ...(g?.joins ?? [])]);
  const whereSql = sql.join(conds, sql` AND `);

  if (!g) {
    const rows = await runRows(
      db,
      sql`SELECT ${x.keyExpr} AS key, ${x.nameExpr} AS display_name, COUNT(DISTINCT i.id)::int AS count
          FROM issues i ${from} WHERE ${whereSql} GROUP BY 1, 2 ORDER BY 1`,
    );
    const data: SimpleItem[] = rows.map((r) => ({ key: r.key || "None", name: r.display_name || "None", count: Number(r.count) }));
    return { data, schema: {} };
  }

  const rows = await runRows(
    db,
    sql`SELECT ${x.keyExpr} AS key, ${g.keyExpr} AS group_key, ${g.nameExpr} AS group_name, ${x.nameExpr} AS display_name, COUNT(DISTINCT i.id)::int AS count
        FROM issues i ${from} WHERE ${whereSql} GROUP BY 1, 2, 3, 4 ORDER BY count DESC`,
  );
  return processGroupedData(rows);
}

/** process_grouped_data — pivot (key, group_key) cells into per-key rows + a group schema. */
function processGroupedData(rows: Row[]): GroupedResult {
  const response = new Map<unknown, Record<string, unknown>>();
  const schema: Record<string, string> = {};
  for (const item of rows) {
    const key = item.key;
    if (!response.has(key)) {
      response.set(key, { key: key || "none", name: item.display_name || "None", count: 0 });
    }
    const entry = response.get(key)!;
    const groupKey = item.group_key ? String(item.group_key) : "none";
    schema[groupKey] = (item.group_name as string) || "None";
    const count = Number(item.count);
    entry[groupKey] = ((entry[groupKey] as number) ?? 0) + count;
    entry.count = (entry.count as number) + count;
  }
  return { data: [...response.values()], schema };
}
