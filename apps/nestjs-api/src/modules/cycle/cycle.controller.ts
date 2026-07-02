import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../infra/auth/current-user.decorator";
import { SessionGuard } from "../../infra/auth/session.guard";
import type { User } from "../../infra/database/schema";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { CycleService } from "./cycle.service";
import { CreateCycleDto, UpdateCycleDto } from "./dto/cycle.dto";

// Mirrors the Cycle ENTITY routes in plane/app/urls/cycle.py (CycleViewSet) plus the
// archive/unarchive actions (CycleArchiveUnarchiveEndpoint). Mounted under /api.
//
// TODO(phase2): cycle-issues (needs issues table) — cycle-issues/, transfer-issues/, progress/,
// analytics/, date-check/ and user-favorite-cycles/ routes are deferred (issue/favorite dependent).
@Controller("api/workspaces/:slug/projects/:project_id/cycles")
@UseGuards(SessionGuard, RbacGuard)
export class CycleController {
  constructor(private readonly service: CycleService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @HttpCode(201)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  create(@Param("project_id") projectId: string, @Body() dto: CreateCycleDto, @CurrentUser() user: User) {
    return this.service.create(projectId, dto, user.id);
  }

  // Archive: POST cycles/:cycle_id/archive (declared before :pk routes for clarity).
  @Post(":cycle_id/archive")
  @HttpCode(200)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  archive(@Param("project_id") projectId: string, @Param("cycle_id") cycleId: string) {
    return this.service.archive(projectId, cycleId);
  }

  // Unarchive: DELETE cycles/:cycle_id/archive.
  @Delete(":cycle_id/archive")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  unarchive(@Param("project_id") projectId: string, @Param("cycle_id") cycleId: string) {
    return this.service.unarchive(projectId, cycleId);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.retrieve(projectId, pk);
  }

  @Put(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  replace(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateCycleDto) {
    return this.service.update(projectId, pk, dto);
  }

  @Patch(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  update(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateCycleDto) {
    return this.service.update(projectId, pk, dto);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN], creator: true, model: "cycles" })
  destroy(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.destroy(projectId, pk);
  }
}

// Archived-cycle listing lives under a different URL base (archived-cycles/), so it is a separate
// controller. The single archived-cycle retrieve (archived-cycles/:pk) is DEFERRED: Django returns a
// heavy issue/estimate distribution payload that requires the issues table.
// TODO(phase2): cycle-issues (needs issues table) — GET archived-cycles/:pk (distribution + burndown).
@Controller("api/workspaces/:slug/projects/:project_id/archived-cycles")
@UseGuards(SessionGuard, RbacGuard)
export class CycleArchiveController {
  constructor(private readonly service: CycleService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  listArchived(@Param("project_id") projectId: string) {
    return this.service.listArchived(projectId);
  }
}
