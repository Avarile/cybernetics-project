// Env must be set before AppModule providers instantiate.
process.env.DATABASE_URL ??= "postgresql://plane:plane@localhost:5433/plane_test";
process.env.SECRET_KEY ??= "e2e-test-secret-key";
process.env.REDIS_URL ??= "redis://localhost:6379/0";
process.env.AMQP_URL ??= "amqp://guest:guest@localhost:5672/";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
});
afterAll(() => app.close());

describe("CSRF", () => {
  it("GET /auth/get-csrf-token returns a token and sets the cookie", async () => {
    const res = await request(app.getHttpServer()).get("/auth/get-csrf-token").expect(200);
    expect(typeof res.body.csrf_token).toBe("string");
    expect(res.body.csrf_token.length).toBeGreaterThan(0);
    expect((res.headers["set-cookie"] || []).join(";")).toContain("csrftoken=");
  });

  it("GET /auth/spaces/get-csrf-token returns a token and sets the cookie", async () => {
    const res = await request(app.getHttpServer()).get("/auth/spaces/get-csrf-token").expect(200);
    expect(typeof res.body.csrf_token).toBe("string");
    expect((res.headers["set-cookie"] || []).join(";")).toContain("csrftoken=");
  });
});
