import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { RequestContextService } from "./request-context";

interface AuthedRequest extends Request {
  user?: { id: string };
}

/**
 * Populates the request context after authentication so repositories can stamp created_by/updated_by
 * from the current user (mirrors Django's crum current-user thread-local). Anonymous -> null.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly ctx: RequestContextService) {}

  intercept(execCtx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = execCtx.switchToHttp().getRequest<AuthedRequest>();
    this.ctx.set("userId", req.user?.id ?? null);
    this.ctx.set("requestId", (req.headers["x-request-id"] as string) ?? null);
    this.ctx.set("origin", `${req.protocol}://${req.get("host") ?? ""}`);
    return next.handle();
  }
}
