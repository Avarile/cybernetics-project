import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../infra/auth/session.guard";
import { RbacGuard } from "../../infra/rbac/rbac.guard";
import { ROLE } from "../../infra/rbac/roles";
import { Roles } from "../../infra/rbac/roles.decorator";
import { CreateWebhookDto, UpdateWebhookDto } from "./dto/webhook.dto";
import { WebhookService } from "./webhook.service";

// Mirrors plane/app/urls/webhook.py — workspace-scoped, admin-gated.
@Controller("api/workspaces/:slug/webhooks")
@UseGuards(SessionGuard, RbacGuard)
export class WebhookController {
  constructor(private readonly service: WebhookService) {}

  @Get()
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE" })
  list(@Param("slug") slug: string) {
    return this.service.list(slug);
  }

  @Post()
  @HttpCode(201)
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE" })
  create(@Param("slug") slug: string, @Body() dto: CreateWebhookDto) {
    return this.service.create(slug, dto);
  }

  @Get(":pk")
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE" })
  retrieve(@Param("slug") slug: string, @Param("pk") pk: string) {
    return this.service.retrieve(slug, pk);
  }

  @Patch(":pk")
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE" })
  update(@Param("slug") slug: string, @Param("pk") pk: string, @Body() dto: UpdateWebhookDto) {
    return this.service.update(slug, pk, dto);
  }

  @Post(":pk/regenerate")
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE" })
  regenerate(@Param("slug") slug: string, @Param("pk") pk: string) {
    return this.service.regenerate(slug, pk);
  }

  @Delete(":pk")
  @HttpCode(204)
  @Roles({ roles: [ROLE.ADMIN], level: "WORKSPACE" })
  destroy(@Param("slug") slug: string, @Param("pk") pk: string) {
    return this.service.destroy(slug, pk);
  }
}
