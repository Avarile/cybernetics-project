import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Request } from "express";
import { DRIZZLE, type Database } from "../database/drizzle.module";
import { apiTokens, users } from "../database/schema";

/**
 * External v1 API auth. Mirror of plane/api/middleware/api_authentication.py::APIKeyAuthentication:
 * X-Api-Key -> active, unexpired token whose user is active; bumps last_used.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown; apiToken?: unknown }>();
    const token = req.headers["x-api-key"];
    if (!token || typeof token !== "string") {
      throw new UnauthorizedException({ detail: "Given API token is not valid" });
    }
    const [row] = await this.db
      .select({ token: apiTokens, user: users })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(
        and(
          eq(apiTokens.token, token),
          eq(apiTokens.isActive, true),
          eq(users.isActive, true),
          or(isNull(apiTokens.expiredAt), gt(apiTokens.expiredAt, new Date())),
        ),
      )
      .limit(1);

    if (!row) throw new UnauthorizedException({ detail: "Given API token is not valid" });

    await this.db.update(apiTokens).set({ lastUsed: new Date() }).where(eq(apiTokens.id, row.token.id));
    req.user = row.user;
    req.apiToken = row.token;
    return true;
  }
}
