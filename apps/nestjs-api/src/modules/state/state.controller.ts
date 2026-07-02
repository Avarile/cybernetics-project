import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../infra/auth/session.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { CreateStateDto, UpdateStateDto } from "./dto/state.dto";
import { StateService } from "./state.service";

// Mirrors plane/app/urls/state.py (StateViewSet). Mounted under /api.
@Controller("api/workspaces/:slug/projects/:project_id/states")
@UseGuards(SessionGuard, RbacGuard)
export class StateController {
  constructor(private readonly service: StateService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string, @Query("grouped") grouped?: string) {
    return this.service.list(projectId, grouped === "true");
  }

  @Post()
  @HttpCode(200) // State create returns 200 in Django
  @Roles({ roles: [ROLE.ADMIN] })
  create(@Param("project_id") projectId: string, @Body() dto: CreateStateDto) {
    return this.service.create(projectId, dto);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.retrieve(projectId, pk);
  }

  @Patch(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  update(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateStateDto) {
    return this.service.update(projectId, pk, dto);
  }

  @Post(":pk/mark-default")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN] })
  markDefault(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.markDefault(projectId, pk);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN] })
  destroy(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.destroy(projectId, pk);
  }
}
