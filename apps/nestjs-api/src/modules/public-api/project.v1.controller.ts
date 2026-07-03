import { Controller, Get, NotFoundException, Param, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiKeyThrottleInterceptor } from "../../infra/auth/api-key-throttle.interceptor";
import { ApiKeyGuard } from "../../infra/auth/api-key.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { ProjectReadRepository, serializeProject } from "./project-read.repository";

// External v1 projects API (read subset of plane/api/urls/project.py). Workspace-scoped.
@Controller("api/v1/workspaces/:slug/projects")
@UseGuards(ApiKeyGuard, RbacGuard)
@UseInterceptors(ApiKeyThrottleInterceptor)
export class ProjectV1Controller {
  constructor(private readonly repo: ProjectReadRepository) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level: "WORKSPACE" })
  async list(@Param("slug") slug: string) {
    const rows = await this.repo.listByWorkspaceSlug(slug);
    return rows.map(serializeProject);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level: "WORKSPACE" })
  async retrieve(@Param("slug") slug: string, @Param("pk") pk: string) {
    const project = await this.repo.findInWorkspaceSlug(slug, pk);
    if (!project) throw new NotFoundException("The requested resource does not exist.");
    return serializeProject(project);
  }
}
