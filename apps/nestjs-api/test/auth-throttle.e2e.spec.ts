// Env must be set before AppModule providers instantiate.
process.env.DATABASE_URL ??= "postgresql://plane:plane@localhost:5433/plane_test";
process.env.SECRET_KEY ??= "e2e-test-secret-key";
process.env.REDIS_URL ??= "redis://localhost:6379/0";
process.env.AMQP_URL ??= "amqp://guest:guest@localhost:5672/";

import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AUTHENTICATION_ERROR_CODES } from "../src/infra/auth/error-codes";
import { ConfigService } from "../src/infra/config/config.service";

// DI-scoped override (not process.env) so the low limit can't leak into other e2e files that
// share this worker's process.env and assume the real default (10/minute).
class LowRateLimitConfigService extends ConfigService {
  get<T = string>(key: string, fallback?: T): T {
    if (key === "AUTHENTICATION_RATE_LIMIT") return "3/minute" as unknown as T;
    return super.get(key, fallback);
  }
}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useClass(LowRateLimitConfigService)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});
afterAll(() => app.close());

// infra/auth/auth-throttle.guard.ts -- global APP_GUARD that only meters /auth/* (see shouldSkip),
// configured via ThrottlerModule.forRootAsync + parseRateLimit(AUTHENTICATION_RATE_LIMIT). Mirrors
// Django's authentication/rate_limit.py::AuthenticationThrottle.
describe("auth throttle", () => {
  it("allows the configured N requests to an /auth/* route, then 429s RATE_LIMIT_EXCEEDED", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post("/auth/email-check")
        .send({ email: `throttle-${randomUUID()}@x.io` })
        .expect(200);
    }
    const res = await request(app.getHttpServer())
      .post("/auth/email-check")
      .send({ email: `throttle-${randomUUID()}@x.io` })
      .expect(429);
    expect(res.body).toEqual({
      error_code: String(AUTHENTICATION_ERROR_CODES.RATE_LIMIT_EXCEEDED),
      error_message: "RATE_LIMIT_EXCEEDED",
    });
  });

  it("does not throttle routes outside /auth/*", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get("/health").expect(200);
    }
  });
});
