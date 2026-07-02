import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request } from "express";
import { ClsService } from "nestjs-cls";
import type { Observable } from "rxjs";
import { CLS_ORIGIN, CLS_REQUEST_ID, CLS_USER_ID } from "./cls.constants";

interface AuthedRequest extends Request {
  user?: { id: string };
}

/**
 * Populates the CLS context after authentication so repositories can stamp created_by/updated_by
 * from the current user (mirrors Django's crum current-user thread-local). Anonymous -> null.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    this.cls.set(CLS_USER_ID, req.user?.id ?? null);
    this.cls.set(CLS_REQUEST_ID, (req.headers["x-request-id"] as string) ?? null);
    this.cls.set(CLS_ORIGIN, `${req.protocol}://${req.get("host") ?? ""}`);
    return next.handle();
  }
}
