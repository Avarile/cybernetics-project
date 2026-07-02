import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../infra/auth/session.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { CreateViewDto, UpdateViewDto } from "./dto/view.dto";
import { ViewService } from "./view.service";

// created_by == owned_by at creation (both = request.user) and owned_by is read-only, so the RbacGuard
// creator bypass (created_by check) faithfully reproduces Django's owner checks on update/destroy.
const VIEW_MODEL = "issue_views";

/**
 * Project-level saved views — mirrors IssueViewViewSet in plane/app/urls/views.py.
 * create/update(PUT) are undecorated in Django (IsAuthenticated only); PATCH carries the
 * creator-only gate. We route PUT to the same owner-gated handler as PATCH (safer, matches the
 * primary PATCH behaviour). @Roles default level = PROJECT.
 */
@Controller("api/workspaces/:slug/projects/:project_id/views")
@UseGuards(SessionGuard, RbacGuard)
export class ProjectViewController {
  constructor(private readonly service: ViewService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string) {
    return this.service.listProject(projectId);
  }

  @Post()
  @HttpCode(201)
  // Django: IssueViewViewSet.create is undecorated -> authenticated only (no role gate).
  create(@Param("project_id") projectId: string, @Body() dto: CreateViewDto) {
    return this.service.createProject(projectId, dto);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.retrieveProject(projectId, pk);
  }

  @Put(":pk")
  @Roles({ roles: [], creator: true, model: VIEW_MODEL })
  replace(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateViewDto) {
    return this.service.updateProject(projectId, pk, dto);
  }

  @Patch(":pk")
  @Roles({ roles: [], creator: true, model: VIEW_MODEL })
  update(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateViewDto) {
    return this.service.updateProject(projectId, pk, dto);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN], creator: true, model: VIEW_MODEL })
  destroy(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.destroyProject(projectId, pk);
  }
}

/**
 * Workspace-level (global) saved views — mirrors WorkspaceViewViewSet. project IS NULL.
 * Django: create AND retrieve are undecorated (authenticated only); list/partial_update/destroy are
 * gated at level = WORKSPACE. PUT is routed to the same owner-gated handler as PATCH.
 */
@Controller("api/workspaces/:slug/views")
@UseGuards(SessionGuard, RbacGuard)
export class WorkspaceViewController {
  constructor(private readonly service: ViewService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level: "WORKSPACE" })
  list(@Param("slug") slug: string) {
    return this.service.listWorkspace(slug);
  }

  @Post()
  @HttpCode(201)
  // Django: WorkspaceViewViewSet.create is undecorated -> authenticated only.
  create(@Param("slug") slug: string, @Body() dto: CreateViewDto) {
    return this.service.createWorkspace(slug, dto);
  }

  @Get(":pk")
  // Django: WorkspaceViewViewSet.retrieve is undecorated -> authenticated only.
  retrieve(@Param("slug") slug: string, @Param("pk") pk: string) {
    return this.service.retrieveWorkspace(slug, pk);
  }

  @Put(":pk")
  @Roles({ roles: [], level: "WORKSPACE", creator: true, model: VIEW_MODEL })
  replace(@Param("slug") slug: string, @Param("pk") pk: string, @Body() dto: UpdateViewDto) {
    return this.service.updateWorkspace(slug, pk, dto);
  }

  @Patch(":pk")
  @Roles({ roles: [], level: "WORKSPACE", creator: true, model: VIEW_MODEL })
  update(@Param("slug") slug: string, @Param("pk") pk: string, @Body() dto: UpdateViewDto) {
    return this.service.updateWorkspace(slug, pk, dto);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE", creator: true, model: VIEW_MODEL })
  destroy(@Param("slug") slug: string, @Param("pk") pk: string) {
    return this.service.destroyWorkspace(slug, pk);
  }
}
