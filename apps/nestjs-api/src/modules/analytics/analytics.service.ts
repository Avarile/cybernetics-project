import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { buildGraphPlot } from "./analytics-plot";
import { buildIssueFilters, type FilterMethod } from "./issue-filters";

type Params = Record<string, unknown>;
type Row = Record<string, unknown>;

// avatar_url Case: /api/assets/v2/static/<asset>/ when avatar_asset set, else the avatar text field.
const avatarUrl = (prefix: string): SQL =>
  sql`CASE WHEN u.avatar_asset_id IS NOT NULL THEN '/api/assets/v2/static/' || u.avatar_asset_id::text || '/' ELSE u.avatar END AS ${sql.raw(`"${prefix}avatar_url"`)}`;

/**
 * Port of plane/app/views/analytic/base.py aggregation logic — AnalyticsEndpoint, DefaultAnalytics,
 * ProjectStats and the saved-view distribution. Uses raw parameterised SQL for faithful GROUP BYs.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async rows(query: SQL): Promise<Row[]> {
    const res = await this.db.execute(query);
    return (res as unknown as { rows: Row[] }).rows;
  }

  private workspaceScope(slug: string): SQL {
    return sql`i.workspace_id = (SELECT id FROM workspaces WHERE slug = ${slug} LIMIT 1)`;
  }

  /** Issue.issue_objects.filter(workspace__slug=slug, **filters) — over alias `i`. */
  private issueObjectsBase(slug: string, params: Params, method: FilterMethod): SQL[] {
    return [
      sql`i.deleted_at IS NULL`,
      sql`i.archived_at IS NULL`,
      sql`i.is_draft = false`,
      sql`(i.state_id IS NULL OR i.state_id NOT IN (SELECT id FROM states WHERE "group" = 'triage'))`,
      sql`i.project_id NOT IN (SELECT id FROM projects WHERE archived_at IS NOT NULL)`,
      this.workspaceScope(slug),
      ...buildIssueFilters(params, method),
    ];
  }

  /** Issue.objects.filter(...) — default (soft-delete only) manager, used by label_details. */
  private issueDefaultBase(slug: string, params: Params, method: FilterMethod): SQL[] {
    return [sql`i.deleted_at IS NULL`, this.workspaceScope(slug), ...buildIssueFilters(params, method)];
  }

  private async count(where: SQL[]): Promise<number> {
    const [r] = await this.rows(sql`SELECT COUNT(*)::int AS count FROM issues i WHERE ${sql.join(where, sql` AND `)}`);
    return Number(r?.count ?? 0);
  }

  // ---- AnalyticsEndpoint ---------------------------------------------------

  async analytics(slug: string, params: Params, xAxis: string, yAxis: string, segment: string | null) {
    const where = this.issueObjectsBase(slug, params, "GET");
    const total = await this.count(where);
    const distribution = await buildGraphPlot(this.db, { where, xAxis, yAxis, segment });

    const wants = (f: string) => xAxis === f || segment === f;
    const w = sql.join(where, sql` AND `);

    const state_details = wants("state_id")
      ? await this.rows(
          sql`SELECT DISTINCT ON (i.state_id) i.state_id AS state_id, s.name AS "state__name", s.color AS "state__color"
              FROM issues i LEFT JOIN states s ON s.id = i.state_id WHERE ${w} ORDER BY i.state_id`,
        )
      : {};

    const label_details = wants("labels__id")
      ? await this.rows(
          sql`SELECT DISTINCT ON (il.label_id) il.label_id AS "labels__id", l.color AS "labels__color", l.name AS "labels__name"
              FROM issues i JOIN issue_labels il ON il.issue_id = i.id AND il.deleted_at IS NULL JOIN labels l ON l.id = il.label_id
              WHERE ${sql.join(this.issueDefaultBase(slug, params, "GET"), sql` AND `)} AND il.label_id IS NOT NULL ORDER BY il.label_id`,
        )
      : {};

    const assignee_details = wants("assignees__id")
      ? await this.rows(
          sql`SELECT DISTINCT ON (ia.assignee_id) ${avatarUrl("assignees__")}, u.display_name AS "assignees__display_name",
                u.first_name AS "assignees__first_name", u.last_name AS "assignees__last_name", ia.assignee_id AS "assignees__id"
              FROM issues i JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.deleted_at IS NULL JOIN users u ON u.id = ia.assignee_id
              WHERE ${w} AND (u.avatar IS NOT NULL OR u.avatar_asset_id IS NOT NULL) ORDER BY ia.assignee_id`,
        )
      : {};

    const cycle_details = wants("issue_cycle__cycle_id")
      ? await this.rows(
          sql`SELECT DISTINCT ON (ci.cycle_id) ci.cycle_id AS "issue_cycle__cycle_id", cy.name AS "issue_cycle__cycle__name"
              FROM issues i JOIN cycle_issues ci ON ci.issue_id = i.id AND ci.deleted_at IS NULL JOIN cycles cy ON cy.id = ci.cycle_id
              WHERE ${w} AND ci.cycle_id IS NOT NULL ORDER BY ci.cycle_id`,
        )
      : {};

    const module_details = wants("issue_module__module_id")
      ? await this.rows(
          sql`SELECT DISTINCT ON (mi.module_id) mi.module_id AS "issue_module__module_id", mo.name AS "issue_module__module__name"
              FROM issues i JOIN module_issues mi ON mi.issue_id = i.id AND mi.deleted_at IS NULL JOIN modules mo ON mo.id = mi.module_id
              WHERE ${w} AND mi.module_id IS NOT NULL ORDER BY mi.module_id`,
        )
      : {};

    return { total, distribution, extras: { state_details, assignee_details, label_details, cycle_details, module_details } };
  }

  // ---- SavedAnalyticEndpoint ----------------------------------------------

  /** Distribution for a stored AnalyticView.query_dict (POST-mode filters). */
  async savedDistribution(slug: string, queryDict: Params, xAxis: string, yAxis: string, segment: string | null) {
    const where = this.issueObjectsBase(slug, queryDict, "POST");
    const total = await this.count(where);
    const distribution = await buildGraphPlot(this.db, { where, xAxis, yAxis, segment });
    return { total, distribution };
  }

  // ---- DefaultAnalyticsEndpoint -------------------------------------------

  async defaultAnalytics(slug: string, params: Params) {
    const base = this.issueObjectsBase(slug, params, "GET");
    const w = sql.join(base, sql` AND `);
    const openGroups = sql`s."group" IN ('backlog','unstarted','started')`;

    const total_issues = await this.count(base);

    const total_issues_classified = await this.rows(
      sql`SELECT s."group" AS state_group, COUNT(s."group")::int AS state_count
          FROM issues i LEFT JOIN states s ON s.id = i.state_id WHERE ${w} GROUP BY s."group" ORDER BY s."group"`,
    );

    const [openRow] = await this.rows(
      sql`SELECT COUNT(*)::int AS count FROM issues i JOIN states s ON s.id = i.state_id WHERE ${w} AND ${openGroups}`,
    );
    const open_issues = Number(openRow?.count ?? 0);

    const open_issues_classified = await this.rows(
      sql`SELECT s."group" AS state_group, COUNT(s."group")::int AS state_count
          FROM issues i JOIN states s ON s.id = i.state_id WHERE ${w} AND ${openGroups} GROUP BY s."group" ORDER BY s."group"`,
    );

    const issue_completed_month_wise = await this.rows(
      sql`SELECT EXTRACT(MONTH FROM i.completed_at)::int AS month, COUNT(*)::int AS count
          FROM issues i WHERE ${w} AND EXTRACT(YEAR FROM i.completed_at) = EXTRACT(YEAR FROM CURRENT_DATE)
          GROUP BY month ORDER BY month`,
    );

    const most_issue_created_user = await this.rows(
      sql`SELECT u.first_name AS "created_by__first_name", u.last_name AS "created_by__last_name",
                u.display_name AS "created_by__display_name", u.id AS "created_by__id", COUNT(i.id)::int AS count, ${avatarUrl("created_by__")}
          FROM issues i JOIN users u ON u.id = i.created_by WHERE ${w} AND i.created_by IS NOT NULL
          GROUP BY u.id, u.first_name, u.last_name, u.display_name, u.avatar_asset_id, u.avatar
          ORDER BY count DESC LIMIT 5`,
    );

    const closedAssignee = (extra: SQL): SQL =>
      sql`SELECT u.first_name AS "assignees__first_name", u.last_name AS "assignees__last_name",
                u.display_name AS "assignees__display_name", u.id AS "assignees__id", COUNT(i.id)::int AS count, ${avatarUrl("assignees__")}
          FROM issues i JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.deleted_at IS NULL JOIN users u ON u.id = ia.assignee_id
          WHERE ${w} AND ${extra}
          GROUP BY u.id, u.first_name, u.last_name, u.display_name, u.avatar_asset_id, u.avatar`;

    const most_issue_closed_user = await this.rows(sql`${closedAssignee(sql`i.completed_at IS NOT NULL`)} ORDER BY count DESC LIMIT 5`);
    const pending_issue_user = await this.rows(sql`${closedAssignee(sql`i.completed_at IS NULL`)} ORDER BY count DESC`);

    const [openEst] = await this.rows(
      sql`SELECT SUM(i.point) AS sum FROM issues i JOIN states s ON s.id = i.state_id WHERE ${w} AND ${openGroups}`,
    );
    const [totalEst] = await this.rows(sql`SELECT SUM(i.point) AS sum FROM issues i WHERE ${w}`);

    return {
      total_issues,
      total_issues_classified,
      open_issues,
      open_issues_classified,
      issue_completed_month_wise,
      most_issue_created_user,
      most_issue_closed_user,
      pending_issue_user,
      open_estimate_sum: openEst?.sum == null ? null : Number(openEst.sum),
      total_estimate_sum: totalEst?.sum == null ? null : Number(totalEst.sum),
    };
  }

  // ---- ProjectStatsEndpoint -----------------------------------------------

  async projectStats(slug: string, fields: string[], projectIds: string[]) {
    const valid = new Set(["total_issues", "completed_issues", "total_members", "total_cycles", "total_modules"]);
    let requested = new Set(fields.filter((f) => valid.has(f)));
    if (requested.size === 0) requested = valid;

    // issue_objects predicate for a subquery aliased `ii`.
    const iiBase = sql`ii.deleted_at IS NULL AND ii.archived_at IS NULL AND ii.is_draft = false
      AND (ii.state_id IS NULL OR ii.state_id NOT IN (SELECT id FROM states WHERE "group" = 'triage'))`;

    const cols: SQL[] = [sql`p.id AS id`];
    if (requested.has("total_issues"))
      cols.push(sql`(SELECT COUNT(*)::int FROM issues ii WHERE ii.project_id = p.id AND ${iiBase}) AS total_issues`);
    if (requested.has("completed_issues"))
      cols.push(
        sql`(SELECT COUNT(*)::int FROM issues ii WHERE ii.project_id = p.id AND ${iiBase} AND ii.state_id IN (SELECT id FROM states WHERE "group" IN ('completed','cancelled'))) AS completed_issues`,
      );
    if (requested.has("total_cycles"))
      cols.push(sql`(SELECT COUNT(*)::int FROM cycles c WHERE c.project_id = p.id AND c.deleted_at IS NULL) AS total_cycles`);
    if (requested.has("total_modules"))
      cols.push(sql`(SELECT COUNT(*)::int FROM modules m WHERE m.project_id = p.id AND m.deleted_at IS NULL) AS total_modules`);
    if (requested.has("total_members"))
      cols.push(
        sql`(SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id = p.id AND pm.is_active = true AND pm.deleted_at IS NULL AND pm.member_id IN (SELECT id FROM users WHERE is_bot = false)) AS total_members`,
      );

    const conds: SQL[] = [sql`p.workspace_id = (SELECT id FROM workspaces WHERE slug = ${slug} LIMIT 1)`];
    if (projectIds.length) conds.push(sql`p.id IN (${sql.join(projectIds.map((id) => sql`${id}`), sql`, `)})`);

    return this.rows(sql`SELECT ${sql.join(cols, sql`, `)} FROM projects p WHERE ${sql.join(conds, sql` AND `)}`);
  }
}
