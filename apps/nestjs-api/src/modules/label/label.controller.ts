import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../infra/auth/session.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { CreateLabelDto, UpdateLabelDto } from "./dto/label.dto";
import { LabelService } from "./label.service";

// Mirrors the issue-labels routes in plane/app/urls/issue.py (LabelViewSet).
@Controller("api/workspaces/:slug/projects/:project_id/issue-labels")
@UseGuards(SessionGuard, RbacGuard)
export class LabelController {
  constructor(private readonly service: LabelService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @HttpCode(201)
  @Roles({ roles: [ROLE.ADMIN] })
  create(@Param("project_id") projectId: string, @Body() dto: CreateLabelDto) {
    return this.service.create(projectId, dto);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.retrieve(projectId, pk);
  }

  @Put(":pk")
  @Roles({ roles: [ROLE.ADMIN] })
  replace(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateLabelDto) {
    return this.service.update(projectId, pk, dto);
  }

  @Patch(":pk")
  @Roles({ roles: [ROLE.ADMIN] })
  update(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateLabelDto) {
    return this.service.update(projectId, pk, dto);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN] })
  destroy(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.destroy(projectId, pk);
  }
}
