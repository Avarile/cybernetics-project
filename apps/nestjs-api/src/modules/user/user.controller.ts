import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../infra/auth/current-user.decorator";
import { SessionGuard } from "../../infra/auth/session.guard";
import type { User } from "../../infra/database/schema";
import { serializeUser } from "./user.serializer";

@Controller("api/users")
@UseGuards(SessionGuard)
export class UserController {
  @Get("me")
  me(@CurrentUser() user: User) {
    return serializeUser(user);
  }
}
