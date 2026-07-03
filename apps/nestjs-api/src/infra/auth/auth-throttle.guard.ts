import { ExecutionContext, HttpException, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import { AUTHENTICATION_ERROR_CODES } from "./error-codes";

/**
 * Registered as a global guard (app.module.ts) via ThrottlerModule.forRootAsync +
 * parseRateLimit(AUTHENTICATION_RATE_LIMIT), but only actually throttles /auth/* routes --
 * mirrors Django's authentication/rate_limit.py::AuthenticationThrottle (scope "authentication",
 * default 10/minute) without rate-limiting the rest of the API.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    return !req.path.startsWith("/auth");
  }

  /** JSON error shape matches ApiKeyThrottleInterceptor / AuthenticationThrottle.throttle_failure_view. */
  protected async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      { error_code: AUTHENTICATION_ERROR_CODES.RATE_LIMIT_EXCEEDED, error_message: "RATE_LIMIT_EXCEEDED" },
      429,
    );
  }
}
