import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "./session.service";

/**
 * Resolves the Django session cookie. Path-based cookie selection matches the custom
 * SessionMiddleware: "instances" in path => admin-session-id, else session-id.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown; sessionRow?: unknown }>();
    const cookieName = req.path.includes("instances") ? "admin-session-id" : "session-id";
    const key = req.cookies?.[cookieName];
    if (!key) {
      throw new UnauthorizedException({ detail: "Authentication credentials were not provided." });
    }
    const resolved = await this.sessions.resolve(key);
    if (!resolved) throw new UnauthorizedException({ detail: "Invalid session" });
    req.user = resolved.user;
    req.sessionRow = resolved.session;
    return true;
  }
}
