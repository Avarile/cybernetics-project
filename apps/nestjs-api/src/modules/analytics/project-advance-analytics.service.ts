import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { analyticsRangeConds, baseFilters, chartRangeConds, issueObjects, type AnalyticsScope, type DateRange } from "./analytics-filters";
import { buildAnalyticsChart } from "./build-chart";
import { COMPLETION_SCHEMA } from "./advance-analytics.service";

type Row = Record<string, unknown>;
const pad = (n: number) => String(n).padStart(2, "0");
const EMPTY = { data: [] as Array<Record<string, unknown>>, schema: {} as Record<string, string> };

/** Accepts a Date (cycle datetime) or a "YYYY-MM-DD" string (module date field); returns YYYY-MM-DD. */
function toYmd(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : null;
}
const ymdToUtc = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const dateToYmd = (d: Date): string => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * Port of plane/app/views/analytic/project_analytics.py — ProjectAdvanceAnalytics{,Stats,Chart}Endpoint.
 * Same member-scoped base_filters as the workspace surface, but always project-bound and with
 * optional cycle_id / module_id narrowing (via the cycle_issues / module_issues join tables).
 */
@Injectable()
export class ProjectAdvanceAnalyticsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute(query) as unknown as { rows: Row[] }).rows;
  }

  private async count(from: SQL, where: SQL[]): Promise<number> {
    const [r] = await this.rows(sql`SELECT COUNT(*)::int AS count FROM ${from} WHERE ${sql.join(where, sql` AND `)}`);
    return Number(r?.count ?? 0);
  }

  private async filteredCount(from: SQL, where: SQL[], createdAt: SQL, range: DateRange | null): Promise<{ count: number }> {
    return { count: await this.count(from, [...where, ...analyticsRangeConds(createdAt, range)]) };
  }

  /** base issue WHERE: project-bound, or narrowed to a cycle / module via its join table. */
  private issueWhere(scope: AnalyticsScope, projectId: string, cycleId?: string | null, moduleId?: string | null): SQL[] {
    if (cycleId) {
      const ci = [...baseFilters("ci", scope), sql`ci.cycle_id = ${cycleId}`];
      return [...issueObjects("i"), sql`i.id IN (SELECT ci.issue_id FROM cycle_issues ci WHERE ${sql.join(ci, sql` AND `)})`];
    }
    if (moduleId) {
      const mi = [...baseFilters("mi", scope), sql`mi.module_id = ${moduleId}`];
      return [...issueObjects("i"), sql`i.id IN (SELECT mi.issue_id FROM module_issues mi WHERE ${sql.join(mi, sql` AND `)})`];
    }
    return [...issueObjects("i"), ...baseFilters("i", scope), sql`i.project_id = ${projectId}`];
  }

  // ---- ProjectAdvanceAnalyticsEndpoint (type=analytics) -------------------

  async workItemsStats(scope: AnalyticsScope, projectId: string, cycleId: string | null, moduleId: string | null, range: DateRange | null) {
    const base = this.issueWhere(scope, projectId, cycleId, moduleId);
    const grouped = (g: string) => this.filteredCount(sql`issues i JOIN states s ON s.id = i.state_id`, [...base, sql`s."group" = ${g}`], sql`i.created_at`, range);
    const [total, started, backlog, unstarted, completed] = await Promise.all([
      this.filteredCount(sql`issues i`, base, sql`i.created_at`, range),
      grouped("started"),
      grouped("backlog"),
      grouped("unstarted"),
      grouped("completed"),
    ]);
    return {
      total_work_items: total,
      started_work_items: started,
      backlog_work_items: backlog,
      un_started_work_items: unstarted,
      completed_work_items: completed,
    };
  }

  // ---- ProjectAdvanceAnalyticsStatsEndpoint (type=work-items) -------------

  async statsByAssignee(scope: AnalyticsScope, projectId: string, cycleId: string | null, moduleId: string | null) {
    const base = this.issueWhere(scope, projectId, cycleId, moduleId);
    const avatarUrl = sql`CASE WHEN ua.avatar_asset_id IS NOT NULL THEN '/api/assets/v2/static/' || ua.avatar_asset_id::text || '/' ELSE ua.avatar END`;
    const filt = (g: string) => sql`(COUNT(DISTINCT i.id) FILTER (WHERE s."group" = ${g}))::int`;
    return this.rows(
      sql`SELECT ua.display_name AS display_name, ia.assignee_id AS assignee_id, ${avatarUrl} AS avatar_url,
            ${filt("cancelled")} AS cancelled_work_items,
            ${filt("completed")} AS completed_work_items,
            ${filt("backlog")} AS backlog_work_items,
            ${filt("unstarted")} AS un_started_work_items,
            ${filt("started")} AS started_work_items
          FROM issues i
            LEFT JOIN issue_assignees ia ON ia.issue_id = i.id
            LEFT JOIN users ua ON ua.id = ia.assignee_id
            LEFT JOIN states s ON s.id = i.state_id
          WHERE ${sql.join(base, sql` AND `)}
          GROUP BY 1, 2, 3 ORDER BY 1`,
    );
  }

  // ---- ProjectAdvanceAnalyticsChartEndpoint (type=custom-work-items) ------

  chartCustomWorkItems(
    scope: AnalyticsScope,
    projectId: string,
    cycleId: string | null,
    moduleId: string | null,
    range: [string, string] | null,
    xAxis: string,
    groupBy: string | null,
  ) {
    const where = [...issueObjects("i"), ...baseFilters("i", scope), sql`i.project_id = ${projectId}`];
    if (cycleId) {
      const ci = [...baseFilters("ci", scope), sql`ci.cycle_id = ${cycleId}`];
      where.push(sql`i.id IN (SELECT ci.issue_id FROM cycle_issues ci WHERE ${sql.join(ci, sql` AND `)})`);
    } else if (moduleId) {
      const mi = [...baseFilters("mi", scope), sql`mi.module_id = ${moduleId}`];
      where.push(sql`i.id IN (SELECT mi.issue_id FROM module_issues mi WHERE ${sql.join(mi, sql` AND `)})`);
    }
    where.push(...chartRangeConds(sql`i.created_at`, range));
    return buildAnalyticsChart(this.db, where, xAxis, groupBy);
  }

  // ---- ProjectAdvanceAnalyticsChartEndpoint (type=work-items) -------------

  async chartWorkItemsCompletion(scope: AnalyticsScope, projectId: string, cycleId: string | null, moduleId: string | null, range: [string, string] | null) {
    if (cycleId) return this.dailyCompletion("cycle_issues", "cycle_id", cycleId, scope, await this.cycleWindow(cycleId));
    if (moduleId) return this.dailyCompletion("module_issues", "module_id", moduleId, scope, await this.moduleWindow(moduleId));
    return this.monthlyCompletion(scope, projectId, range);
  }

  private async cycleWindow(cycleId: string): Promise<{ start: string; end: string } | null> {
    const [c] = await this.rows(sql`SELECT start_date, end_date FROM cycles WHERE id = ${cycleId} LIMIT 1`);
    const start = toYmd(c?.start_date);
    const end = toYmd(c?.end_date);
    return start && end ? { start, end } : null;
  }

  private async moduleWindow(moduleId: string): Promise<{ start: string; end: string } | null> {
    const [m] = await this.rows(sql`SELECT start_date, target_date FROM modules WHERE id = ${moduleId} LIMIT 1`);
    const start = toYmd(m?.start_date);
    const end = toYmd(m?.target_date);
    return start && end ? { start, end } : null;
  }

  /** Daily created/completed series over a cycle/module window, grouped by the join-row created_at::date. */
  private async dailyCompletion(
    joinTable: "cycle_issues" | "module_issues",
    fkCol: "cycle_id" | "module_id",
    fkId: string,
    scope: AnalyticsScope,
    window: { start: string; end: string } | null,
  ) {
    if (!window) return EMPTY;
    const jt = sql.raw(joinTable);
    const fk = sql.raw(`j.${fkCol}`);
    const where = [...baseFilters("j", scope), sql`${fk} = ${fkId}`];
    const daily = await this.rows(
      sql`SELECT j.created_at::date::text AS day,
            COUNT(j.id)::int AS created_count,
            (COUNT(j.id) FILTER (WHERE s."group" = 'completed'))::int AS completed_count
          FROM ${jt} j LEFT JOIN issues i ON i.id = j.issue_id LEFT JOIN states s ON s.id = i.state_id
          WHERE ${sql.join(where, sql` AND `)}
          GROUP BY 1 ORDER BY 1`,
    );
    const stats = new Map<string, { created: number; completed: number }>();
    for (const r of daily) stats.set(String(r.day), { created: Number(r.created_count), completed: Number(r.completed_count) });

    const data: Array<Record<string, unknown>> = [];
    let cur = ymdToUtc(window.start);
    const end = ymdToUtc(window.end);
    while (cur.getTime() <= end.getTime()) {
      const key = dateToYmd(cur);
      const s = stats.get(key) ?? { created: 0, completed: 0 };
      data.push({ key, name: key, count: s.created + s.completed, completed_issues: s.completed, created_issues: s.created });
      cur = new Date(cur.getTime() + 86_400_000);
    }
    return { data, schema: { ...COMPLETION_SCHEMA } };
  }

  /** Monthly created/completed series from the project's creation month to the current month. */
  private async monthlyCompletion(scope: AnalyticsScope, projectId: string, range: [string, string] | null) {
    const [p] = await this.rows(sql`SELECT created_at FROM projects WHERE id = ${projectId} LIMIT 1`);
    if (!p?.created_at) return EMPTY;
    const c = new Date(p.created_at as string);
    const start = { y: c.getUTCFullYear(), m: c.getUTCMonth() + 1, d: 1 };

    const base = [...issueObjects("i"), ...baseFilters("i", scope), sql`i.project_id = ${projectId}`, ...chartRangeConds(sql`i.created_at`, range)];
    const monthly = await this.rows(
      sql`SELECT to_char(date_trunc('month', i.created_at), 'YYYY-MM-DD') AS month,
            COUNT(i.id)::int AS created_count,
            (COUNT(i.id) FILTER (WHERE s."group" = 'completed'))::int AS completed_count
          FROM issues i LEFT JOIN states s ON s.id = i.state_id
          WHERE ${sql.join(base, sql` AND `)}
          GROUP BY 1 ORDER BY 1`,
    );
    const stats = new Map<string, { created: number; completed: number }>();
    for (const r of monthly) stats.set(String(r.month), { created: Number(r.created_count), completed: Number(r.completed_count) });

    const now = new Date();
    const last = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: 1 };
    const asNum = (x: { y: number; m: number; d: number }) => x.y * 10000 + x.m * 100 + x.d;
    const data: Array<Record<string, unknown>> = [];
    const cur = { ...start };
    while (asNum(cur) <= asNum(last)) {
      const key = `${cur.y}-${pad(cur.m)}-${pad(cur.d)}`;
      const s = stats.get(key) ?? { created: 0, completed: 0 };
      data.push({ key, name: key, count: s.created, completed_issues: s.completed, created_issues: s.created });
      if (cur.m === 12) {
        cur.y += 1;
        cur.m = 1;
      } else {
        cur.m += 1;
      }
    }
    return { data, schema: { ...COMPLETION_SCHEMA } };
  }
}
