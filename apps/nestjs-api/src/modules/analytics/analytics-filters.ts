import { sql, type SQL } from "drizzle-orm";

/**
 * Port of plane/utils/date_utils.py (get_analytics_date_range / get_chart_period_range /
 * get_analytics_filters) plus the SQL predicate builders that stand in for the Django ORM
 * filter dicts used by the advance-analytics surface (member-scoped `base_filters` /
 * `project_filters`). All date math is done in UTC to match Django's timezone.now() under the
 * UTC settings Plane runs with.
 */

export interface AnalyticsScope {
  slug: string;
  userId: string;
  projectIds: string[]; // parsed from ?project_ids=a,b — empty means "no explicit project filter"
}

export interface DateRange {
  current: { gte: Date; lte: Date };
  previous?: { gte: Date; lte: Date };
}

// ---- date helpers (UTC) ----------------------------------------------------

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

function utcToday(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * DAY_MS);
const startOfDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
const endOfDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
/** "YYYY-MM-DD" for a UTC date. */
export const ymd = (d: Date): string => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** get_analytics_date_range — current (+ previous for comparison) datetime windows. */
export function getAnalyticsDateRange(dateFilter?: string | null): DateRange | null {
  if (!dateFilter) return null;
  const today = utcToday();
  const cur = (fromDays: number, toDays: number) => ({ gte: startOfDay(addDays(today, fromDays)), lte: endOfDay(addDays(today, toDays)) });
  switch (dateFilter) {
    case "yesterday":
      return { current: cur(-1, -1) };
    case "last_7_days":
      return { current: cur(-7, 0), previous: cur(-14, -8) };
    case "last_30_days":
      return { current: cur(-30, 0), previous: cur(-60, -31) };
    case "last_3_months":
      return { current: cur(-90, 0), previous: cur(-180, -91) };
    default:
      return null;
  }
}

/** get_analytics_date_range for the "custom" branch (needs explicit start/end YYYY-MM-DD). */
export function getCustomAnalyticsDateRange(startDate?: string | null, endDate?: string | null): DateRange | null {
  if (!startDate || !endDate) return null;
  const s = parseYmd(startDate);
  const e = parseYmd(endDate);
  if (!s || !e) return null;
  return { current: { gte: startOfDay(s), lte: endOfDay(e) } };
}

/** get_chart_period_range — (start, end) date-only strings for created_at__date comparisons. */
export function getChartPeriodRange(dateFilter?: string | null): [string, string] | null {
  if (!dateFilter) return null;
  const today = utcToday();
  const ranges: Record<string, [Date, Date]> = {
    yesterday: [addDays(today, -1), addDays(today, -1)],
    last_7_days: [addDays(today, -7), today],
    last_30_days: [addDays(today, -30), today],
    last_3_months: [addDays(today, -90), today],
  };
  const r = ranges[dateFilter];
  return r ? [ymd(r[0]), ymd(r[1])] : null;
}

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseProjectIds(raw?: string | null): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// ---- SQL predicate builders ------------------------------------------------

const wsIdSubquery = (slug: string): SQL => sql`(SELECT id FROM workspaces WHERE slug = ${slug} LIMIT 1)`;
// Django base_filters join `project__project_projectmember__member=user, ...is_active=True` maps to a
// raw project_members join (no soft-delete filter — managers don't affect relation traversal).
const membershipProjects = (userId: string): SQL => sql`(SELECT project_id FROM project_members WHERE member_id = ${userId} AND is_active = true)`;
const liveProjects: SQL = sql`(SELECT id FROM projects WHERE deleted_at IS NULL AND archived_at IS NULL)`;
const col = (alias: string, name: string): SQL => sql.raw(`${alias}.${name}`);
const inList = (expr: SQL, ids: string[]): SQL => sql`${expr} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;

/** base_filters for a workspace+project-scoped model (alias has workspace_id + project_id). */
export function baseFilters(alias: string, scope: AnalyticsScope): SQL[] {
  const conds: SQL[] = [
    sql`${col(alias, "workspace_id")} = ${wsIdSubquery(scope.slug)}`,
    sql`${col(alias, "project_id")} IN ${membershipProjects(scope.userId)}`,
    sql`${col(alias, "project_id")} IN ${liveProjects}`,
  ];
  if (scope.projectIds.length) conds.push(inList(col(alias, "project_id"), scope.projectIds));
  return conds;
}

/** project_filters for the projects table (alias `p`). */
export function projectFilters(alias: string, scope: AnalyticsScope): SQL[] {
  const conds: SQL[] = [
    sql`${col(alias, "workspace_id")} = ${wsIdSubquery(scope.slug)}`,
    sql`${col(alias, "id")} IN ${membershipProjects(scope.userId)}`,
    sql`${col(alias, "deleted_at")} IS NULL`,
    sql`${col(alias, "archived_at")} IS NULL`,
  ];
  if (scope.projectIds.length) conds.push(inList(col(alias, "id"), scope.projectIds));
  return conds;
}

/** Issue.issue_objects manager predicates (SoftDeletionManager + triage/archived/draft excludes). */
export function issueObjects(alias: string): SQL[] {
  return [
    sql`${col(alias, "deleted_at")} IS NULL`,
    sql`${col(alias, "archived_at")} IS NULL`,
    sql`${col(alias, "is_draft")} = false`,
    sql`(${col(alias, "state_id")} IS NULL OR ${col(alias, "state_id")} NOT IN (SELECT id FROM states WHERE "group" = 'triage'))`,
    sql`${col(alias, "project_id")} NOT IN (SELECT id FROM projects WHERE archived_at IS NOT NULL)`,
  ];
}

/** created_at BETWEEN the analytics_date_range current window (get_filtered_counts). */
export function analyticsRangeConds(createdAt: SQL, range: DateRange | null): SQL[] {
  if (!range) return [];
  return [sql`${createdAt} >= ${range.current.gte}`, sql`${createdAt} <= ${range.current.lte}`];
}

/** created_at::date BETWEEN the chart_period_range (project_chart date_filter). */
export function chartRangeConds(createdAt: SQL, range: [string, string] | null): SQL[] {
  if (!range) return [];
  return [sql`${createdAt}::date >= ${range[0]}`, sql`${createdAt}::date <= ${range[1]}`];
}
