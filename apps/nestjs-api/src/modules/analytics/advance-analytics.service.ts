import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { ROLE } from "../../infra/rbac/roles";
import {
  analyticsRangeConds,
  baseFilters,
  chartRangeConds,
  issueObjects,
  projectFilters,
  type AnalyticsScope,
  type DateRange,
} from "./analytics-filters";
import { buildAnalyticsChart } from "./build-chart";

type Row = Record<string, unknown>;

const idIn = (expr: SQL, ids: string[]): SQL => sql`${expr} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
const titleCase = (k: string): string => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Port of plane/app/views/analytic/advance.py — AdvanceAnalyticsEndpoint (overview / work-items),
 * AdvanceAnalyticsStatsEndpoint (per-project work-item counts) and AdvanceAnalyticsChartEndpoint
 * (projects / work-items completion / custom-work-items). Member-scoped via `base_filters`.
 */
@Injectable()
export class AdvanceAnalyticsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute(query) as unknown as { rows: Row[] }).rows;
  }

  private async count(from: SQL, where: SQL[]): Promise<number> {
    const [r] = await this.rows(sql`SELECT COUNT(*)::int AS count FROM ${from} WHERE ${sql.join(where, sql` AND `)}`);
    return Number(r?.count ?? 0);
  }

  /** get_filtered_counts — {count} with the analytics_date_range current window on created_at. */
  private async filteredCount(from: SQL, where: SQL[], createdAt: SQL, range: DateRange | null): Promise<{ count: number }> {
    return { count: await this.count(from, [...where, ...analyticsRangeConds(createdAt, range)]) };
  }

  // ---- AdvanceAnalyticsEndpoint (tab=overview) ----------------------------

  async overview(scope: AnalyticsScope, range: DateRange | null) {
    const members = this.membersSource(scope);
    const withRole = (role: ROLE) => [...members.where, sql`${members.roleCol} = ${role}`];
    const issueBase = [...issueObjects("i"), ...baseFilters("i", scope)];

    const [totalUsers, totalAdmins, totalMembers, totalGuests, totalProjects, totalWorkItems, totalCycles, totalIntake] = await Promise.all([
      this.filteredCount(members.from, members.where, members.createdAt, range),
      this.filteredCount(members.from, withRole(ROLE.ADMIN), members.createdAt, range),
      this.filteredCount(members.from, withRole(ROLE.MEMBER), members.createdAt, range),
      this.filteredCount(members.from, withRole(ROLE.GUEST), members.createdAt, range),
      this.filteredCount(sql`projects p`, projectFilters("p", scope), sql`p.created_at`, range),
      this.filteredCount(sql`issues i`, issueBase, sql`i.created_at`, range),
      this.filteredCount(sql`cycles c`, [...baseFilters("c", scope), sql`c.deleted_at IS NULL`], sql`c.created_at`, range),
      this.filteredCount(
        sql`issues i JOIN intake_issues ii ON ii.issue_id = i.id AND ii.status IN (-2, -1, 0, 1, 2)`,
        [sql`i.deleted_at IS NULL`, ...baseFilters("i", scope)],
        sql`i.created_at`,
        range,
      ),
    ]);

    return {
      total_users: totalUsers,
      total_admins: totalAdmins,
      total_members: totalMembers,
      total_guests: totalGuests,
      total_projects: totalProjects,
      total_work_items: totalWorkItems,
      total_cycles: totalCycles,
      total_intake: totalIntake,
    };
  }

  /** members_query: workspace members, or project members when project_ids is given. */
  private membersSource(scope: AnalyticsScope): { from: SQL; where: SQL[]; createdAt: SQL; roleCol: SQL } {
    if (scope.projectIds.length) {
      return {
        from: sql`project_members pm JOIN users u ON u.id = pm.member_id`,
        where: [idIn(sql`pm.project_id`, scope.projectIds), sql`pm.is_active = true`, sql`u.is_bot = false`, sql`pm.deleted_at IS NULL`],
        createdAt: sql`pm.created_at`,
        roleCol: sql`pm.role`,
      };
    }
    return {
      from: sql`workspace_members wm JOIN users u ON u.id = wm.member_id`,
      where: [
        sql`wm.workspace_id = (SELECT id FROM workspaces WHERE slug = ${scope.slug} LIMIT 1)`,
        sql`wm.is_active = true`,
        sql`u.is_bot = false`,
        sql`wm.deleted_at IS NULL`,
      ],
      createdAt: sql`wm.created_at`,
      roleCol: sql`wm.role`,
    };
  }

  // ---- AdvanceAnalyticsEndpoint (tab=work-items) --------------------------

  async workItemsStats(scope: AnalyticsScope, range: DateRange | null) {
    const base = [...issueObjects("i"), ...baseFilters("i", scope)];
    const grouped = (group: string) => this.filteredCount(sql`issues i JOIN states s ON s.id = i.state_id`, [...base, sql`s."group" = ${group}`], sql`i.created_at`, range);

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

  // ---- AdvanceAnalyticsStatsEndpoint (type=work-items) --------------------

  async statsByProject(scope: AnalyticsScope) {
    const base = [...issueObjects("i"), ...baseFilters("i", scope)];
    const filt = (group: string) => sql`(COUNT(i.id) FILTER (WHERE s."group" = ${group}))::int`;
    return this.rows(
      sql`SELECT i.project_id AS project_id, p.name AS "project__name",
            ${filt("cancelled")} AS cancelled_work_items,
            ${filt("completed")} AS completed_work_items,
            ${filt("backlog")} AS backlog_work_items,
            ${filt("unstarted")} AS un_started_work_items,
            ${filt("started")} AS started_work_items
          FROM issues i LEFT JOIN states s ON s.id = i.state_id JOIN projects p ON p.id = i.project_id
          WHERE ${sql.join(base, sql` AND `)}
          GROUP BY i.project_id, p.name ORDER BY i.project_id`,
    );
  }

  // ---- AdvanceAnalyticsChartEndpoint (type=projects) ----------------------

  async chartProjects(scope: AnalyticsScope, range: [string, string] | null) {
    const issueBase = [...issueObjects("i"), ...baseFilters("i", scope)];
    const [work_items, cycles, modules, intake, members, pages, views] = await Promise.all([
      this.count(sql`issues i`, [...issueBase, ...chartRangeConds(sql`i.created_at`, range)]),
      this.count(sql`cycles c`, [...baseFilters("c", scope), sql`c.deleted_at IS NULL`, ...chartRangeConds(sql`c.created_at`, range)]),
      this.count(sql`modules m`, [...baseFilters("m", scope), sql`m.deleted_at IS NULL`, ...chartRangeConds(sql`m.created_at`, range)]),
      this.count(sql`issues i JOIN intake_issues ii ON ii.issue_id = i.id`, [sql`i.deleted_at IS NULL`, ...baseFilters("i", scope), ...chartRangeConds(sql`i.created_at`, range)]),
      this.count(sql`workspace_members wm`, [
        sql`wm.workspace_id = (SELECT id FROM workspaces WHERE slug = ${scope.slug} LIMIT 1)`,
        sql`wm.is_active = true`,
        sql`wm.deleted_at IS NULL`,
        ...chartRangeConds(sql`wm.created_at`, range),
      ]),
      this.count(sql`project_pages pp`, [...baseFilters("pp", scope), sql`pp.deleted_at IS NULL`, ...chartRangeConds(sql`pp.created_at`, range)]),
      this.count(sql`issue_views v`, [...baseFilters("v", scope), sql`v.deleted_at IS NULL`, ...chartRangeConds(sql`v.created_at`, range)]),
    ]);
    const data: Record<string, number> = { work_items, cycles, modules, intake, members, pages, views };
    return Object.entries(data).map(([key, value]) => ({ key, name: titleCase(key), count: value || 0 }));
  }

  // ---- AdvanceAnalyticsChartEndpoint (type=work-items) --------------------

  async chartWorkItemsCompletion(scope: AnalyticsScope, range: [string, string] | null) {
    const base = [...issueObjects("i"), ...baseFilters("i", scope), ...chartRangeConds(sql`i.created_at`, range)];
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

    // start = chart range start, else first-of-month of workspace creation.
    let start: { y: number; m: number; d: number };
    if (range) {
      const [ry, rm, rd] = range[0].split("-").map(Number);
      start = { y: ry, m: rm, d: rd };
    } else {
      const [w] = await this.rows(sql`SELECT created_at FROM workspaces WHERE slug = ${scope.slug} LIMIT 1`);
      if (!w?.created_at) return { data: [], schema: COMPLETION_SCHEMA };
      const c = new Date(w.created_at as string);
      start = { y: c.getUTCFullYear(), m: c.getUTCMonth() + 1, d: 1 };
    }

    const now = new Date();
    const last = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: 1 };
    const asNum = (p: { y: number; m: number; d: number }) => p.y * 10000 + p.m * 100 + p.d;

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
    return { data, schema: COMPLETION_SCHEMA };
  }

  // ---- AdvanceAnalyticsChartEndpoint (type=custom-work-items) -------------

  chartCustomWorkItems(scope: AnalyticsScope, range: [string, string] | null, xAxis: string, groupBy: string | null) {
    const where = [...issueObjects("i"), ...baseFilters("i", scope), ...chartRangeConds(sql`i.created_at`, range)];
    return buildAnalyticsChart(this.db, where, xAxis, groupBy);
  }
}

export const COMPLETION_SCHEMA = { completed_issues: "completed_issues", created_issues: "created_issues" } as const;
