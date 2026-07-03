import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../infra/auth/current-user.decorator";
import { SessionGuard } from "../../infra/auth/session.guard";
import type { User } from "../../infra/database/schema";
import { CeleryProducer } from "../../infra/queue/celery-producer.service";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { AnalyticViewRepository, serializeAnalyticView } from "./analytic-view.repository";
import { VALID_ANALYTICS_FIELDS, VALID_YAXIS } from "./analytics-plot";
import { AnalyticsService } from "./analytics.service";
import { AnalyticViewDto } from "./analytics.dto";

const isField = (v: unknown): v is string => typeof v === "string" && (VALID_ANALYTICS_FIELDS as readonly string[]).includes(v);
const isYAxis = (v: unknown): v is string => typeof v === "string" && (VALID_YAXIS as readonly string[]).includes(v);

const AXIS_ERROR = { error: "x-axis and y-axis dimensions are required and the values should be valid" };
const SEGMENT_ERROR = { error: "Both segment and x axis cannot be same and segment should be valid" };

@Controller("api/workspaces/:slug")
@UseGuards(SessionGuard, RbacGuard)
export class AnalyticsController {
  constructor(
    private readonly svc: AnalyticsService,
    private readonly views: AnalyticViewRepository,
    private readonly producer: CeleryProducer,
  ) {}

  // GET analytics/ — the main distribution graph.
  @Get("analytics")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], level: "WORKSPACE" })
  async analytics(@Param("slug") slug: string, @Query() query: Record<string, string>) {
    const { x_axis, y_axis, segment } = query;
    if (!x_axis || !y_axis || !isField(x_axis) || !isYAxis(y_axis)) throw new BadRequestException(AXIS_ERROR);
    if (segment && (!isField(segment) || x_axis === segment)) throw new BadRequestException(SEGMENT_ERROR);
    return this.svc.analytics(slug, query, x_axis, y_axis, segment || null);
  }

  // GET/POST analytic-view/ — CRUD (workspace admin).
  @Get("analytic-view")
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE" })
  async list(@Param("slug") slug: string) {
    const wsId = await this.views.workspaceIdBySlug(slug);
    if (!wsId) return [];
    const rows = await this.views.listByWorkspace(wsId);
    return rows.map(serializeAnalyticView);
  }

  @Post("analytic-view")
  @HttpCode(201)
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE" })
  async create(@Param("slug") slug: string, @Body() body: AnalyticViewDto) {
    if (!body.name) throw new BadRequestException({ name: ["This field is required."] });
    const wsId = await this.views.workspaceIdBySlug(slug);
    if (!wsId) throw new NotFoundException("The required object does not exist.");
    const queryDict = body.query_dict ?? {};
    const created = await this.views.create({
      workspaceId: wsId,
      name: body.name,
      description: body.description ?? "",
      queryDict,
      query: queryDict, // NestJS stores query_dict as the filter; SavedAnalytic re-derives from it.
    });
    return serializeAnalyticView(created);
  }

  @Get("analytic-view/:pk")
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE" })
  async retrieve(@Param("slug") slug: string, @Param("pk") pk: string) {
    const view = await this.findView(slug, pk);
    return serializeAnalyticView(view);
  }

  @Patch("analytic-view/:pk")
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE" })
  async update(@Param("slug") slug: string, @Param("pk") pk: string, @Body() body: AnalyticViewDto) {
    const view = await this.findView(slug, pk);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.query_dict !== undefined) patch.queryDict = body.query_dict;
    const updated = await this.views.update(view.id, patch);
    return serializeAnalyticView(updated!);
  }

  @Delete("analytic-view/:pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE" })
  async destroy(@Param("slug") slug: string, @Param("pk") pk: string) {
    const view = await this.findView(slug, pk);
    await this.views.softDelete(view.id);
  }

  // GET saved-analytic-view/:analytic_id/ — distribution for a stored view.
  @Get("saved-analytic-view/:analytic_id")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], level: "WORKSPACE" })
  async saved(@Param("slug") slug: string, @Param("analytic_id") analyticId: string, @Query("segment") segment?: string) {
    const view = await this.findView(slug, analyticId);
    const qd = (view.queryDict ?? {}) as Record<string, unknown>;
    const x_axis = qd.x_axis as string | undefined;
    const y_axis = qd.y_axis as string | undefined;
    if (!x_axis || !y_axis || !isField(x_axis) || !isYAxis(y_axis)) throw new BadRequestException(AXIS_ERROR);
    if (segment && (!isField(segment) || x_axis === segment)) throw new BadRequestException(SEGMENT_ERROR);
    return this.svc.savedDistribution(slug, qd, x_axis, y_axis, segment || null);
  }

  // POST export-analytics/ — enqueue the export task, email when ready.
  @Post("export-analytics")
  @HttpCode(200)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], level: "WORKSPACE" })
  async export(@Param("slug") slug: string, @Body() data: Record<string, unknown>, @CurrentUser() user: User) {
    const x_axis = data.x_axis as string | undefined;
    const y_axis = data.y_axis as string | undefined;
    const segment = data.segment as string | undefined;
    if (!x_axis || !y_axis || !isField(x_axis) || !isYAxis(y_axis)) throw new BadRequestException(AXIS_ERROR);
    if (segment && (!isField(segment) || x_axis === segment)) throw new BadRequestException(SEGMENT_ERROR);
    await this.producer.enqueue(CELERY_TASKS.analyticExport, { email: user.email, data, slug });
    return { message: `Once the export is ready it will be emailed to you at ${user.email}` };
  }

  // GET default-analytics/ — workspace dashboard summary.
  @Get("default-analytics")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level: "WORKSPACE" })
  defaultAnalytics(@Param("slug") slug: string, @Query() query: Record<string, string>) {
    return this.svc.defaultAnalytics(slug, query);
  }

  // GET project-stats/ — per-project counts.
  @Get("project-stats")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level: "WORKSPACE" })
  projectStats(@Param("slug") slug: string, @Query("fields") fields = "", @Query("project_ids") projectIds = "") {
    return this.svc.projectStats(
      slug,
      fields.split(",").filter(Boolean),
      projectIds.split(",").filter(Boolean),
    );
  }

  private async findView(slug: string, id: string) {
    const wsId = await this.views.workspaceIdBySlug(slug);
    const view = wsId ? await this.views.findInWorkspace(id, wsId) : null;
    if (!view) throw new NotFoundException("The required object does not exist.");
    return view;
  }
}
