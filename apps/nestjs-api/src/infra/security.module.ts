import { Global, Module } from "@nestjs/common";
import { ApiKeyThrottleInterceptor } from "./auth/api-key-throttle.interceptor";
import { ApiKeyGuard } from "./auth/api-key.guard";
import { SessionGuard } from "./auth/session.guard";
import { SessionService } from "./auth/session.service";
import { MemberService } from "./rbac/member.service";
import { RbacGuard } from "./rbac/rbac.guard";

/** Global provider of auth/session + RBAC building blocks used by controllers via @UseGuards. */
@Global()
@Module({
  providers: [SessionService, SessionGuard, ApiKeyGuard, ApiKeyThrottleInterceptor, MemberService, RbacGuard],
  exports: [SessionService, SessionGuard, ApiKeyGuard, ApiKeyThrottleInterceptor, MemberService, RbacGuard],
})
export class SecurityModule {}
