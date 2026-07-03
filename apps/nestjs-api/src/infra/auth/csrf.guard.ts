import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { CsrfService } from "./csrf.service";

/**
 * Applied to form-POST endpoints only (see Task 10/11) -- pre-login JSON endpoints skip CSRF to
 * match Django. Not wired into any route yet.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrf: CsrfService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!this.csrf.validate(req)) {
      throw new ForbiddenException({ detail: "CSRF Failed: CSRF token missing or incorrect." });
    }
    return true;
  }
}
