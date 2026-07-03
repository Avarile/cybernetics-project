import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Request } from "express";
import { ApiKeyThrottleInterceptor } from "../../infra/auth/api-key-throttle.interceptor";
import { ApiKeyGuard } from "../../infra/auth/api-key.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { CreateIssueDto, UpdateIssueDto } from "../issue/dto/issue.dto";
import { IssueService } from "../issue/issue.service";

/**
 * External v1 work-item API (X-Api-Key + throttle), mirroring plane/api/urls/work_item.py. Reuses
 * IssueService (same advisory-lock create + annotations). NOTE: responses currently use the app
 * serializer shape; the v1 IssueSerializer (excludes description_json/stripped, `assignees`/`labels`
 * keys) is a follow-up refinement.
 */
@Controller("api/v1/workspaces/:slug/projects/:project_id/work-items")
@UseGuards(ApiKeyGuard, RbacGuard)
@UseInterceptors(ApiKeyThrottleInterceptor)
export class WorkItemV1Controller {
  constructor(private readonly issues: IssueService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string, @Query("cursor") cursor?: string, @Query("per_page") perPage?: string) {
    return this.issues.list(projectId, { cursor, perPage: perPage ? Number(perPage) : undefined });
  }

  @Post()
  @HttpCode(201)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  create(@Param("slug") slug: string, @Param("project_id") projectId: string, @Body() dto: CreateIssueDto) {
    return this.issues.create(slug, projectId, dto);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.issues.retrieve(projectId, pk);
  }

  @Patch(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  update(@Param("slug") slug: string, @Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateIssueDto) {
    return this.issues.update(slug, projectId, pk, dto);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  destroy(@Param("slug") slug: string, @Param("project_id") projectId: string, @Param("pk") pk: string, @Req() _req: Request) {
    return this.issues.destroy(slug, projectId, pk);
  }
}
