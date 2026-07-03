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

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});
afterAll(() => app.close());

// emailCheck is read-only (it never creates a row), so each test uses a fresh randomUUID email --
// no beforeAll reset needed for a users row that's never written.
describe("email-check", () => {
  const newEmail = `new-${randomUUID()}@x.io`;

  describe("POST /auth/email-check", () => {
    it("returns existing:false, status:CREDENTIAL for a brand-new email (magic disabled by default seed)", async () => {
      const res = await request(app.getHttpServer()).post("/auth/email-check").send({ email: newEmail }).expect(200);
      expect(res.body).toEqual({ existing: false, status: "CREDENTIAL" });
    });

    it("returns 400 EMAIL_REQUIRED when email is missing", async () => {
      const res = await request(app.getHttpServer()).post("/auth/email-check").send({}).expect(400);
      expect(res.body.error_message).toBe("EMAIL_REQUIRED");
      expect(res.body.error_code).toBeDefined();
    });
  });

  describe("POST /auth/spaces/email-check", () => {
    it("returns existing:false, status:CREDENTIAL for a brand-new email", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/spaces/email-check")
        .send({ email: `spaces-${newEmail}` })
        .expect(200);
      expect(res.body).toEqual({ existing: false, status: "CREDENTIAL" });
    });

    it("returns 400 EMAIL_REQUIRED when email is missing", async () => {
      const res = await request(app.getHttpServer()).post("/auth/spaces/email-check").send({}).expect(400);
      expect(res.body.error_message).toBe("EMAIL_REQUIRED");
      expect(res.body.error_code).toBeDefined();
    });
  });
});
