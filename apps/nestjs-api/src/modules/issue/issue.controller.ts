import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../../infra/auth/session.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { CreateIssueDto, UpdateIssueDto } from "./dto/issue.dto";
import { IssueService } from "./issue.service";

// Mirrors the IssueViewSet routes in plane/app/urls/issue.py.
@Controller("api/workspaces/:slug/projects/:project_id/issues")
@UseGuards(SessionGuard, RbacGuard)
export class IssueController {
  constructor(private readonly service: IssueService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string, @Query("cursor") cursor?: string, @Query("per_page") perPage?: string) {
    return this.service.list(projectId, { cursor, perPage: perPage ? Number(perPage) : undefined });
  }

  @Post()
  @HttpCode(201)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  create(@Param("slug") slug: string, @Param("project_id") projectId: string, @Body() dto: CreateIssueDto) {
    return this.service.create(slug, projectId, dto);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], creator: true, model: "issues" })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.retrieve(projectId, pk);
  }

  @Put(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], creator: true, model: "issues" })
  replace(@Param("slug") slug: string, @Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateIssueDto) {
    return this.service.update(slug, projectId, pk, dto);
  }

  @Patch(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], creator: true, model: "issues" })
  update(@Param("slug") slug: string, @Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateIssueDto) {
    return this.service.update(slug, projectId, pk, dto);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN], creator: true, model: "issues" })
  destroy(@Param("slug") slug: string, @Param("project_id") projectId: string, @Param("pk") pk: string, @Req() _req: Request) {
    return this.service.destroy(slug, projectId, pk);
  }
}
