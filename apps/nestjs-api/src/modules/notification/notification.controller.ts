import { Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../infra/auth/current-user.decorator";
import { SessionGuard } from "../../infra/auth/session.guard";
import type { User } from "../../infra/database/schema";
import { NotificationService, type ListFilters } from "./notification.service";

// Mirrors plane/app/urls/notification.py (per-user notifications, workspace-scoped).
@Controller("api/workspaces/:slug/users/notifications")
@UseGuards(SessionGuard)
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  list(
    @Param("slug") slug: string,
    @CurrentUser() user: User,
    @Query("cursor") cursor?: string,
    @Query("per_page") perPage?: string,
    @Query("archived") archived?: string,
    @Query("read") read?: string,
    @Query("snoozed") snoozed?: string,
  ) {
    const filters: ListFilters = {
      archived: archived === "true",
      snoozed: snoozed === "true" ? true : undefined,
      read: read === "true" ? true : read === "false" ? false : undefined,
    };
    return this.service.list(slug, user.id, filters, { cursor, perPage: perPage ? Number(perPage) : undefined });
  }

  @Get("unread")
  unread(@Param("slug") slug: string, @CurrentUser() user: User) {
    return this.service.unreadCount(slug, user.id);
  }

  @Post("mark-all-read")
  @HttpCode(204)
  markAll(@Param("slug") slug: string, @CurrentUser() user: User) {
    return this.service.markAllRead(slug, user.id);
  }

  @Post(":pk/read")
  @HttpCode(204)
  markRead(@CurrentUser() user: User, @Param("pk") pk: string) {
    return this.service.markRead(user.id, pk);
  }

  @Delete(":pk/read")
  @HttpCode(204)
  markUnread(@CurrentUser() user: User, @Param("pk") pk: string) {
    return this.service.markUnread(user.id, pk);
  }

  @Post(":pk/archive")
  @HttpCode(204)
  archive(@CurrentUser() user: User, @Param("pk") pk: string) {
    return this.service.archive(user.id, pk);
  }

  @Delete(":pk/archive")
  @HttpCode(204)
  unarchive(@CurrentUser() user: User, @Param("pk") pk: string) {
    return this.service.unarchive(user.id, pk);
  }
}
