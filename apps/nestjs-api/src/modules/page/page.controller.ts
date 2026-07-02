import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../infra/auth/current-user.decorator";
import { SessionGuard } from "../../infra/auth/session.guard";
import type { User } from "../../infra/database/schema";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { CreatePageDto, PageAccessDto, UpdatePageDto } from "./dto/page.dto";
import { PageService } from "./page.service";

// Mirrors the PageViewSet routes in plane/app/urls/page.py. Access rules follow ProjectPagePermission:
// GET -> ADMIN/MEMBER/GUEST, POST/PATCH -> ADMIN/MEMBER, DELETE -> ADMIN, with a page-owner bypass
// (owned_by == created_by for pages, so the RbacGuard creator bypass reproduces it). Object-level
// owner / private-access / lock rules are enforced in PageService. Route param is :pk so the guard's
// creator check reads it. Version history, favorites, description-binary sync & duplicate are deferred.
@Controller("api/workspaces/:slug/projects/:project_id")
@UseGuards(SessionGuard, RbacGuard)
export class PageController {
  constructor(private readonly service: PageService) {}

  @Get("pages-summary")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  summary(@Param("project_id") projectId: string, @CurrentUser() user: User) {
    return this.service.summary(projectId, user.id);
  }

  @Get("pages")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string, @CurrentUser() user: User) {
    return this.service.list(projectId, user.id);
  }

  @Post("pages")
  @HttpCode(201)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  create(@Param("project_id") projectId: string, @CurrentUser() user: User, @Body() dto: CreatePageDto) {
    return this.service.create(projectId, user.id, dto);
  }

  @Get("pages/:pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], creator: true, model: "pages" })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string, @CurrentUser() user: User) {
    return this.service.retrieve(projectId, pk, user.id);
  }

  @Patch("pages/:pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], creator: true, model: "pages" })
  update(
    @Param("project_id") projectId: string,
    @Param("pk") pk: string,
    @CurrentUser() user: User,
    @Body() dto: UpdatePageDto,
  ) {
    return this.service.update(projectId, pk, user.id, dto);
  }

  @Delete("pages/:pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN], creator: true, model: "pages" })
  destroy(@Param("project_id") projectId: string, @Param("pk") pk: string, @CurrentUser() user: User) {
    return this.service.destroy(projectId, pk, user.id);
  }

  @Post("pages/:pk/archive")
  @HttpCode(200)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], creator: true, model: "pages" })
  archive(@Param("project_id") projectId: string, @Param("pk") pk: string, @CurrentUser() user: User) {
    return this.service.archive(projectId, pk, user.id);
  }

  @Delete("pages/:pk/archive")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN], creator: true, model: "pages" })
  unarchive(@Param("project_id") projectId: string, @Param("pk") pk: string, @CurrentUser() user: User) {
    return this.service.unarchive(projectId, pk, user.id);
  }

  @Post("pages/:pk/lock")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], creator: true, model: "pages" })
  lock(@Param("project_id") projectId: string, @Param("pk") pk: string, @CurrentUser() user: User) {
    return this.service.lock(projectId, pk, user.id);
  }

  @Delete("pages/:pk/lock")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN], creator: true, model: "pages" })
  unlock(@Param("project_id") projectId: string, @Param("pk") pk: string, @CurrentUser() user: User) {
    return this.service.unlock(projectId, pk, user.id);
  }

  @Post("pages/:pk/access")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER], creator: true, model: "pages" })
  access(
    @Param("project_id") projectId: string,
    @Param("pk") pk: string,
    @CurrentUser() user: User,
    @Body() dto: PageAccessDto,
  ) {
    return this.service.access(projectId, pk, user.id, dto);
  }
}
