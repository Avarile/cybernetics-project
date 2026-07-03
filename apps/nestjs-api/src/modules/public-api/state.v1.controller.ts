import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiKeyThrottleInterceptor } from "../../infra/auth/api-key-throttle.interceptor";
import { ApiKeyGuard } from "../../infra/auth/api-key.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { CreateStateDto, UpdateStateDto } from "../state/dto/state.dto";
import { StateService } from "../state/state.service";

// External v1 states API (mirrors plane/api/urls/state.py). Route param is :state_id.
@Controller("api/v1/workspaces/:slug/projects/:project_id/states")
@UseGuards(ApiKeyGuard, RbacGuard)
@UseInterceptors(ApiKeyThrottleInterceptor)
export class StateV1Controller {
  constructor(private readonly service: StateService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  list(@Param("project_id") projectId: string, @Query("grouped") grouped?: string) {
    return this.service.list(projectId, grouped === "true");
  }

  @Post()
  @HttpCode(201)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  create(@Param("project_id") projectId: string, @Body() dto: CreateStateDto) {
    return this.service.create(projectId, dto);
  }

  @Get(":state_id")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST] })
  retrieve(@Param("project_id") projectId: string, @Param("state_id") stateId: string) {
    return this.service.retrieve(projectId, stateId);
  }

  @Patch(":state_id")
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  update(@Param("project_id") projectId: string, @Param("state_id") stateId: string, @Body() dto: UpdateStateDto) {
    return this.service.update(projectId, stateId, dto);
  }

  @Delete(":state_id")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
  destroy(@Param("project_id") projectId: string, @Param("state_id") stateId: string) {
    return this.service.destroy(projectId, stateId);
  }
}
