import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../infra/auth/session.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import {
  CreateEstimateDto,
  CreateEstimatePointDto,
  DeleteEstimatePointDto,
  UpdateEstimateDto,
  UpdateEstimatePointDto,
} from "./dto/estimate.dto";
import { EstimateService } from "./estimate.service";

/**
 * Mirrors plane/app/urls/estimate.py. Mounted under /api. Covers three Django endpoints:
 *  - ProjectEstimatePointEndpoint (project-estimates)
 *  - BulkEstimatePointEndpoint    (estimates, estimates/:estimate_id)
 *  - EstimatePointEndpoint        (estimates/:estimate_id/estimate-points[/:estimate_point_id])
 *
 * Permissions: BulkEstimatePointEndpoint uses ProjectEntityPermission -> SAFE methods allow any
 * project member (ADMIN/MEMBER/GUEST); write methods require ADMIN/MEMBER. The two @allow_permission
 * endpoints require [ADMIN, MEMBER].
 */
@Controller("api/workspaces/:slug/projects/:project_id")
@UseGuards(SessionGuard, RbacGuard)
export class EstimateController {
  constructor(private readonly service: EstimateService) {}

  // ProjectEstimatePointEndpoint.get -> @allow_permission([ADMIN, MEMBER])
  @Get("project-estimates")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  projectEstimates(@Param("project_id") projectId: string) {
    return this.service.projectEstimates(projectId);
  }

  // BulkEstimatePointEndpoint.list -> ProjectEntityPermission (SAFE)
  @Get("estimates")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string) {
    return this.service.list(projectId);
  }

  // BulkEstimatePointEndpoint.create -> ProjectEntityPermission (write); returns 200 in Django.
  @Post("estimates")
  @HttpCode(200)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  create(@Param("project_id") projectId: string, @Body() dto: CreateEstimateDto) {
    return this.service.create(projectId, dto);
  }

  // BulkEstimatePointEndpoint.retrieve -> ProjectEntityPermission (SAFE)
  @Get("estimates/:estimate_id")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  retrieve(@Param("project_id") projectId: string, @Param("estimate_id") estimateId: string) {
    return this.service.retrieve(projectId, estimateId);
  }

  // BulkEstimatePointEndpoint.partial_update -> ProjectEntityPermission (write)
  @Patch("estimates/:estimate_id")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  update(
    @Param("project_id") projectId: string,
    @Param("estimate_id") estimateId: string,
    @Body() dto: UpdateEstimateDto,
  ) {
    return this.service.update(projectId, estimateId, dto);
  }

  // BulkEstimatePointEndpoint.destroy -> ProjectEntityPermission (write); returns 204.
  @Delete("estimates/:estimate_id")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  destroy(@Param("project_id") projectId: string, @Param("estimate_id") estimateId: string) {
    return this.service.destroy(projectId, estimateId);
  }

  // EstimatePointEndpoint.create -> @allow_permission([ADMIN, MEMBER]); returns 200 in Django.
  @Post("estimates/:estimate_id/estimate-points")
  @HttpCode(200)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  createPoint(
    @Param("project_id") projectId: string,
    @Param("estimate_id") estimateId: string,
    @Body() dto: CreateEstimatePointDto,
  ) {
    return this.service.createPoint(projectId, estimateId, dto);
  }

  // EstimatePointEndpoint.partial_update -> @allow_permission([ADMIN, MEMBER])
  @Patch("estimates/:estimate_id/estimate-points/:estimate_point_id")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  updatePoint(
    @Param("project_id") projectId: string,
    @Param("estimate_id") estimateId: string,
    @Param("estimate_point_id") estimatePointId: string,
    @Body() dto: UpdateEstimatePointDto,
  ) {
    return this.service.updatePoint(projectId, estimateId, estimatePointId, dto);
  }

  // EstimatePointEndpoint.destroy -> @allow_permission([ADMIN, MEMBER]); returns 200 with re-keyed points.
  @Delete("estimates/:estimate_id/estimate-points/:estimate_point_id")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  destroyPoint(
    @Param("project_id") projectId: string,
    @Param("estimate_id") estimateId: string,
    @Param("estimate_point_id") estimatePointId: string,
    @Body() dto: DeleteEstimatePointDto,
  ) {
    return this.service.destroyPoint(projectId, estimateId, estimatePointId, dto);
  }
}
