import { sql, type SQL } from "drizzle-orm";
import type { Database } from "../../infra/database/drizzle.module";

// Port of plane/utils/analytics_plot.py — VALID_* + build_graph_plot.
export const VALID_ANALYTICS_FIELDS = [
  "state_id",
  "state__group",
  "labels__id",
  "assignees__id",
  "estimate_point__value",
  "issue_cycle__cycle_id",
  "issue_module__module_id",
  "priority",
  "start_date",
  "target_date",
  "created_at",
  "completed_at",
] as const;

export const VALID_YAXIS = ["issue_count", "estimate"] as const;

const DATE_FIELDS = new Set(["created_at", "start_date", "target_date", "completed_at"]);

interface Resolved {
  expr: SQL;
  join?: { alias: string; sql: SQL };
  isDate: boolean;
}

function resolveField(field: string): Resolved {
  switch (field) {
    case "state_id":
      return { expr: sql`i.state_id::text`, isDate: false };
    case "state__group":
      return { expr: sql`sg."group"`, join: { alias: "sg", sql: sql`LEFT JOIN states sg ON sg.id = i.state_id` }, isDate: false };
    case "labels__id":
      return {
        expr: sql`il.label_id::text`,
        join: { alias: "il", sql: sql`LEFT JOIN issue_labels il ON il.issue_id = i.id AND il.deleted_at IS NULL` },
        isDate: false,
      };
    case "assignees__id":
      return {
        expr: sql`ia.assignee_id::text`,
        join: { alias: "ia", sql: sql`LEFT JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.deleted_at IS NULL` },
        isDate: false,
      };
    case "estimate_point__value":
      return { expr: sql`ep.value`, join: { alias: "ep", sql: sql`LEFT JOIN estimate_points ep ON ep.id = i.estimate_point_id` }, isDate: false };
    case "issue_cycle__cycle_id":
      return {
        expr: sql`ci.cycle_id::text`,
        join: { alias: "ci", sql: sql`LEFT JOIN cycle_issues ci ON ci.issue_id = i.id AND ci.deleted_at IS NULL` },
        isDate: false,
      };
    case "issue_module__module_id":
      return {
        expr: sql`mi.module_id::text`,
        join: { alias: "mi", sql: sql`LEFT JOIN module_issues mi ON mi.issue_id = i.id AND mi.deleted_at IS NULL` },
        isDate: false,
      };
    case "priority":
      return { expr: sql`i.priority`, isDate: false };
    case "start_date":
    case "target_date":
    case "created_at":
    case "completed_at": {
      const col = sql.raw(`i.${field}`);
      // Django Concat(ExtractYear, '-', ExtractMonth) — no zero-padding ("2024-3").
      return { expr: sql`(EXTRACT(YEAR FROM ${col})::int || '-' || EXTRACT(MONTH FROM ${col})::int)`, isDate: true };
    }
    default:
      throw new Error(`Invalid analytics field: ${field}`);
  }
}

// sort_data(): priority order, else alpha with lowercase "none" last.
function sortData(data: Record<string, unknown[]>, tempAxis: string): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  if (tempAxis === "priority") {
    for (const key of ["low", "medium", "high", "urgent", "none"]) {
      if (key in data) out[key] = data[key];
    }
    return out;
  }
  const keys = Object.keys(data).sort((a, b) => {
    const an = a === "none" ? 1 : 0;
    const bn = b === "none" ? 1 : 0;
    if (an !== bn) return an - bn;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const k of keys) out[k] = data[k];
  return out;
}

export interface GraphPlotArgs {
  where: SQL[]; // base conditions (workspace + issue_objects + issue_filters) over alias `i`
  xAxis: string;
  yAxis: string;
  segment?: string | null;
}

/**
 * Faithful port of build_graph_plot: group the (filtered) issue set by an x-axis dimension (+ optional
 * segment), counting issues or summing estimate values, returning { [dimension]: [rows...] } sorted.
 */
export async function buildGraphPlot(db: Database, { where, xAxis, yAxis, segment }: GraphPlotArgs): Promise<Record<string, unknown[]>> {
  if (!(VALID_ANALYTICS_FIELDS as readonly string[]).includes(xAxis)) throw new Error(`Invalid x_axis value: ${xAxis}`);
  if (!(VALID_YAXIS as readonly string[]).includes(yAxis)) throw new Error(`Invalid y_axis value: ${yAxis}`);
  if (segment && !(VALID_ANALYTICS_FIELDS as readonly string[]).includes(segment)) throw new Error(`Invalid segment value: ${segment}`);

  const x = resolveField(xAxis);
  const seg = segment ? resolveField(segment) : null;

  // Collect joins, deduped by alias. Estimate y-axis always needs estimate_points.
  const joins = new Map<string, SQL>();
  if (x.join) joins.set(x.join.alias, x.join.sql);
  if (seg?.join) joins.set(seg.join.alias, seg.join.sql);
  if (yAxis === "estimate" && !joins.has("ep")) joins.set("ep", sql`LEFT JOIN estimate_points ep ON ep.id = i.estimate_point_id`);

  const conds = [...where];
  if (x.isDate) conds.push(sql`${x.expr} IS NOT NULL`);

  const selectParts: SQL[] = [sql`${x.expr} AS dimension`];
  if (seg) selectParts.push(sql`${seg.expr} AS segment`);
  const agg = yAxis === "issue_count" ? sql`COUNT(*) AS count` : sql`SUM(CAST(ep.value AS double precision)) AS estimate`;
  selectParts.push(agg);

  const groupBy: SQL[] = [sql`dimension`];
  if (seg) groupBy.push(sql`segment`);

  const joinSql = joins.size ? sql.join([...joins.values()], sql` `) : sql``;
  const whereSql = sql.join(conds, sql` AND `);

  const query = sql`SELECT ${sql.join(selectParts, sql`, `)} FROM issues i ${joinSql} WHERE ${whereSql} GROUP BY ${sql.join(groupBy, sql`, `)} ORDER BY dimension`;

  const res = await db.execute(query);
  const rows = (res as unknown as { rows: Array<Record<string, unknown>> }).rows;

  // groupby dimension → { str(dimension): [rows] }, then sort_data.
  const grouped: Record<string, unknown[]> = {};
  for (const r of rows) {
    const key = r.dimension == null ? "None" : String(r.dimension);
    const row: Record<string, unknown> = { dimension: r.dimension == null ? null : String(r.dimension) };
    if (seg) row.segment = r.segment ?? null;
    if (yAxis === "issue_count") row.count = Number(r.count);
    else row.estimate = r.estimate == null ? null : Number(r.estimate);
    (grouped[key] ??= []).push(row);
  }
  return sortData(grouped, xAxis);
}
