import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../infra/auth/session.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import {
  CreateIntakeDto,
  CreateIntakeIssueDto,
  UpdateIntakeDto,
  UpdateIntakeIssueDto,
} from "./dto/intake.dto";
import { IntakeService } from "./intake.service";

// Mirrors IntakeViewSet in plane/app/urls/intake.py — the `intakes/` and `inboxes/` aliases both map here.
@Controller([
  "api/workspaces/:slug/projects/:project_id/intakes",
  "api/workspaces/:slug/projects/:project_id/inboxes",
])
@UseGuards(SessionGuard, RbacGuard)
export class IntakeController {
  constructor(private readonly service: IntakeService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  list(@Param("project_id") projectId: string) {
    return this.service.listIntakes(projectId);
  }

  @Post()
  @HttpCode(201)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  create(@Param("project_id") projectId: string, @Body() dto: CreateIntakeDto) {
    return this.service.createIntake(projectId, dto);
  }

  // Django leaves retrieve/partial_update ungated beyond IsAuthenticated; kept to project members here.
  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.retrieveIntake(projectId, pk);
  }

  @Patch(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  update(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateIntakeDto) {
    return this.service.updateIntake(projectId, pk, dto);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  destroy(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.destroyIntake(projectId, pk);
  }
}

// Mirrors IntakeIssueViewSet — `intake-issues/` and `inbox-issues/` aliases. `:pk` is the *issue* id.
@Controller([
  "api/workspaces/:slug/projects/:project_id/intake-issues",
  "api/workspaces/:slug/projects/:project_id/inbox-issues",
])
@UseGuards(SessionGuard, RbacGuard)
export class IntakeIssueController {
  constructor(private readonly service: IntakeService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(
    @Param("project_id") projectId: string,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("per_page") perPage?: string,
  ) {
    return this.service.listIntakeIssues(projectId, status, {
      cursor,
      perPage: perPage ? Number(perPage) : undefined,
    });
  }

  @Post()
  @HttpCode(200) // IntakeIssue create returns 200 in Django
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  create(@Param("project_id") projectId: string, @Body() dto: CreateIntakeIssueDto) {
    return this.service.createIntakeIssue(projectId, dto);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], creator: true, model: "issues" })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.retrieveIntakeIssue(projectId, pk);
  }

  @Patch(":pk")
  @Roles({ roles: [ROLE.ADMIN], creator: true, model: "issues" })
  update(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateIntakeIssueDto) {
    return this.service.updateIntakeIssue(projectId, pk, dto);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN], creator: true, model: "issues" })
  destroy(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.destroyIntakeIssue(projectId, pk);
  }
}
