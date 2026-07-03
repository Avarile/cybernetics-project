import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiKeyThrottleInterceptor } from "../../infra/auth/api-key-throttle.interceptor";
import { ApiKeyGuard } from "../../infra/auth/api-key.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { CreateLabelDto, UpdateLabelDto } from "../label/dto/label.dto";
import { LabelService } from "../label/label.service";

// External v1 labels API (mirrors plane/api/urls/label.py — base path /labels, not /issue-labels).
@Controller("api/v1/workspaces/:slug/projects/:project_id/labels")
@UseGuards(ApiKeyGuard, RbacGuard)
@UseInterceptors(ApiKeyThrottleInterceptor)
export class LabelV1Controller {
  constructor(private readonly service: LabelService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @HttpCode(201)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  create(@Param("project_id") projectId: string, @Body() dto: CreateLabelDto) {
    return this.service.create(projectId, dto);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  retrieve(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.retrieve(projectId, pk);
  }

  @Patch(":pk")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  update(@Param("project_id") projectId: string, @Param("pk") pk: string, @Body() dto: UpdateLabelDto) {
    return this.service.update(projectId, pk, dto);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  destroy(@Param("project_id") projectId: string, @Param("pk") pk: string) {
    return this.service.destroy(projectId, pk);
  }
}
