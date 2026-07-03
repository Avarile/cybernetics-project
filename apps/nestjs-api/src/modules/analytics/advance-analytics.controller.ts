import { BadRequestException, Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../infra/auth/current-user.decorator";
import { SessionGuard } from "../../infra/auth/session.guard";
import type { User } from "../../infra/database/schema";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { AdvanceAnalyticsService } from "./advance-analytics.service";
import { getAnalyticsDateRange, getChartPeriodRange, parseProjectIds, type AnalyticsScope } from "./analytics-filters";
import { isXAxis } from "./build-chart";

/**
 * Workspace advance-analytics (plane/app/views/analytic/advance.py). Member-scoped: results are
 * limited to the projects the caller is an active member of.
 */
@Controller("api/workspaces/:slug")
@UseGuards(SessionGuard, RbacGuard)
export class AdvanceAnalyticsController {
  constructor(private readonly svc: AdvanceAnalyticsService) {}

  private scope(slug: string, query: Record<string, string>, user: User): AnalyticsScope {
    return { slug, userId: user.id, projectIds: parseProjectIds(query.project_ids) };
  }

  // GET advance-analytics/ — tab=overview | work-items.
  @Get("advance-analytics")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], level: "WORKSPACE" })
  advance(@Param("slug") slug: string, @Query() query: Record<string, string>, @CurrentUser() user: User) {
    const scope = this.scope(slug, query, user);
    const range = getAnalyticsDateRange(query.date_filter);
    const tab = query.tab || "overview";
    if (tab === "overview") return this.svc.overview(scope, range);
    if (tab === "work-items") return this.svc.workItemsStats(scope, range);
    throw new BadRequestException({ message: "Invalid tab" });
  }

  // GET advance-analytics-stats/ — type=work-items (per-project counts).
  @Get("advance-analytics-stats")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], level: "WORKSPACE" })
  stats(@Param("slug") slug: string, @Query() query: Record<string, string>, @CurrentUser() user: User) {
    const scope = this.scope(slug, query, user);
    const type = query.type || "work-items";
    if (type === "work-items") return this.svc.statsByProject(scope);
    throw new BadRequestException({ message: "Invalid type" });
  }

  // GET advance-analytics-charts/ — type=projects | custom-work-items | work-items.
  @Get("advance-analytics-charts")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], level: "WORKSPACE" })
  charts(@Param("slug") slug: string, @Query() query: Record<string, string>, @CurrentUser() user: User) {
    const scope = this.scope(slug, query, user);
    const range = getChartPeriodRange(query.date_filter);
    const type = query.type || "projects";
    if (type === "projects") return this.svc.chartProjects(scope, range);
    if (type === "custom-work-items") {
      const xAxis = query.x_axis || "PRIORITY";
      const groupBy = query.group_by || null;
      if (!isXAxis(xAxis)) throw new BadRequestException({ message: `Invalid x_axis field: ${xAxis}` });
      if (groupBy && !isXAxis(groupBy)) throw new BadRequestException({ message: `Invalid group_by field: ${groupBy}` });
      return this.svc.chartCustomWorkItems(scope, range, xAxis, groupBy);
    }
    if (type === "work-items") return this.svc.chartWorkItemsCompletion(scope, range);
    throw new BadRequestException({ message: "Invalid type" });
  }
}
