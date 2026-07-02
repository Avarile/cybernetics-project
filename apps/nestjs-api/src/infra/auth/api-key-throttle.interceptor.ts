import { CallHandler, ExecutionContext, HttpException, Inject, Injectable, NestInterceptor } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import type { Request, Response } from "express";
import type Redis from "ioredis";
import type { Observable } from "rxjs";
import { REDIS } from "../cache/redis.module";

const PERIOD_SECONDS: Record<string, number> = { s: 1, sec: 1, m: 60, min: 60, h: 3600, hour: 3600, d: 86400, day: 86400 };

/**
 * Redis-backed API-key rate limit (plane/api/rate_limit.py::ApiKeyRateThrottle).
 * scope "api_key", rate from API_KEY_RATE_LIMIT (default 60/minute). Sets X-RateLimit-* headers.
 * DRF cache-key namespace preserved (throttle_api_key:...) so counters unify if Redis is shared.
 */
@Injectable()
export class ApiKeyThrottleInterceptor implements NestInterceptor {
  private readonly num: number;
  private readonly durSec: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
  ) {
    const [n, period] = config.get<string>("API_KEY_RATE_LIMIT", "60/minute").split("/");
    this.num = Number(n) || 60;
    this.durSec = PERIOD_SECONDS[(period ?? "minute").slice(0, 3)] ?? 60;
  }

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const apiKey = req.headers["x-api-key"];
    if (!apiKey || typeof apiKey !== "string") return next.handle(); // no key -> unthrottled (DRF parity)

    const cacheKey = `throttle_api_key:api_key:${apiKey}`;
    const now = Date.now() / 1000;
    const cutoff = now - this.durSec;

    await this.redis.zremrangebyscore(cacheKey, 0, cutoff);
    const count = await this.redis.zcard(cacheKey);
    if (count >= this.num) {
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", Math.floor(now + this.durSec));
      throw new HttpException({ error_code: 5900, error_message: "RATE_LIMIT_EXCEEDED" }, 429);
    }
    await this.redis.zadd(cacheKey, now, `${now}:${Math.random()}`);
    await this.redis.expire(cacheKey, this.durSec);

    res.setHeader("X-RateLimit-Remaining", Math.max(0, this.num - count - 1));
    res.setHeader("X-RateLimit-Reset", Math.floor(now + this.durSec));
    return next.handle();
  }
}
