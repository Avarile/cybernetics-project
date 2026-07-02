import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../infra/auth/session.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { CreateModuleDto, UpdateModuleDto } from "./dto/module.dto";
import { ModuleService } from "./module.service";

// Mirrors plane/app/urls/module.py (ModuleViewSet + archive routes). Mounted under /api.
// NOTE: module-issue routes (ModuleIssueViewSet), module-links, favorites and user-properties are
// intentionally NOT implemented here.
// TODO(phase2): module-issues (needs issues table).
@Controller("api/workspaces/:slug/projects/:project_id/modules")
@UseGuards(SessionGuard, RbacGuard)
export class ModuleController {
  constructor(private readonly service: ModuleService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @HttpCode(201) // Module create returns 201 in Django
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  create(@Param("project_id") projectId: string, @Body() dto: CreateModuleDto) {
    return this.service.create(projectId, dto);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.retrieve(projectId, pk);
  }

  @Put(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  replace(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateModuleDto) {
    return this.service.update(projectId, pk, dto);
  }

  @Patch(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  update(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateModuleDto) {
    return this.service.update(projectId, pk, dto);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN], creator: true, model: "modules" })
  destroy(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.destroy(projectId, pk);
  }

  // ModuleArchiveUnarchiveEndpoint (ProjectEntityPermission): write methods -> ADMIN/MEMBER.
  @Post(":module_id/archive")
  @HttpCode(200)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  archive(@Param("project_id") projectId: string, @Param("module_id") moduleId: string) {
    return this.service.archive(projectId, moduleId);
  }

  @Delete(":module_id/archive")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  unarchive(@Param("project_id") projectId: string, @Param("module_id") moduleId: string) {
    return this.service.unarchive(projectId, moduleId);
  }
}

// ModuleArchiveUnarchiveEndpoint list/retrieve routes (archived-modules/). ProjectEntityPermission on
// SAFE_METHODS -> any active project member (ADMIN/MEMBER/GUEST).
@Controller("api/workspaces/:slug/projects/:project_id/archived-modules")
@UseGuards(SessionGuard, RbacGuard)
export class ArchivedModuleController {
  constructor(private readonly service: ModuleService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string) {
    return this.service.listArchived(projectId);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.retrieveArchived(projectId, pk);
  }
}
