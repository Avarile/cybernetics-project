import { BadRequestException, Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../infra/auth/current-user.decorator";
import { SessionGuard } from "../../infra/auth/session.guard";
import type { User } from "../../infra/database/schema";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { getAnalyticsDateRange, getChartPeriodRange, parseProjectIds, type AnalyticsScope } from "./analytics-filters";
import { isXAxis } from "./build-chart";
import { ProjectAdvanceAnalyticsService } from "./project-advance-analytics.service";

/**
 * Project-scoped advance-analytics (plane/app/views/analytic/project_analytics.py). Project-level
 * permission; optional cycle_id / module_id narrowing.
 */
@Controller("api/workspaces/:slug/projects/:project_id")
@UseGuards(SessionGuard, RbacGuard)
export class ProjectAdvanceAnalyticsController {
  constructor(private readonly svc: ProjectAdvanceAnalyticsService) {}

  private scope(slug: string, query: Record<string, string>, user: User): AnalyticsScope {
    return { slug, userId: user.id, projectIds: parseProjectIds(query.project_ids) };
  }

  // GET advance-analytics/ — work-item counts (optionally by cycle/module).
  @Get("advance-analytics")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  advance(@Param("slug") slug: string, @Param("project_id") projectId: string, @Query() query: Record<string, string>, @CurrentUser() user: User) {
    const scope = this.scope(slug, query, user);
    const range = getAnalyticsDateRange(query.date_filter);
    return this.svc.workItemsStats(scope, projectId, query.cycle_id || null, query.module_id || null, range);
  }

  // GET advance-analytics-stats/ — type=work-items (per-assignee counts).
  @Get("advance-analytics-stats")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  stats(@Param("slug") slug: string, @Param("project_id") projectId: string, @Query() query: Record<string, string>, @CurrentUser() user: User) {
    const scope = this.scope(slug, query, user);
    const type = query.type || "work-items";
    if (type === "work-items") return this.svc.statsByAssignee(scope, projectId, query.cycle_id || null, query.module_id || null);
    throw new BadRequestException({ message: "Invalid type" });
  }

  // GET advance-analytics-charts/ — type=custom-work-items | work-items.
  @Get("advance-analytics-charts")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  charts(@Param("slug") slug: string, @Param("project_id") projectId: string, @Query() query: Record<string, string>, @CurrentUser() user: User) {
    const scope = this.scope(slug, query, user);
    const range = getChartPeriodRange(query.date_filter);
    const type = query.type || "projects";
    const cycleId = query.cycle_id || null;
    const moduleId = query.module_id || null;
    if (type === "custom-work-items") {
      const xAxis = query.x_axis || "PRIORITY";
      const groupBy = query.group_by || null;
      if (!isXAxis(xAxis)) throw new BadRequestException({ message: `Invalid x_axis field: ${xAxis}` });
      if (groupBy && !isXAxis(groupBy)) throw new BadRequestException({ message: `Invalid group_by field: ${groupBy}` });
      return this.svc.chartCustomWorkItems(scope, projectId, cycleId, moduleId, range, xAxis, groupBy);
    }
    if (type === "work-items") return this.svc.chartWorkItemsCompletion(scope, projectId, cycleId, moduleId, range);
    throw new BadRequestException({ message: "Invalid type" });
  }
}
