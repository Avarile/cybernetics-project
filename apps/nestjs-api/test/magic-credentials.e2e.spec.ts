// Env must be set before AppModule providers (DrizzleModule factory) instantiate.
process.env.DATABASE_URL ??= "postgresql://plane:plane@localhost:5433/plane_test";
process.env.SECRET_KEY ??= "e2e-test-secret-key";
process.env.REDIS_URL ??= "redis://localhost:6379/0";
process.env.AMQP_URL ??= "amqp://guest:guest@localhost:5672/";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.WEB_URL ??= "http://localhost:3000";

import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AUTHENTICATION_ERROR_CODES } from "../src/infra/auth/error-codes";
import { DRIZZLE, type Database } from "../src/infra/database/drizzle.module";
import { users } from "../src/infra/database/schema";
import { MagicCodeService } from "../src/modules/auth/magic/magic-code.service";

// Faithful port of views/app/magic.py (MagicSignInEndpoint L64 / MagicSignUpEndpoint L147):
// form-POST -> 302-redirect protocol, CSRF-guarded. plane_test's seed writes
// ENABLE_MAGIC_LINK_LOGIN='0' + EMAIL_HOST='' (see magic-generate.e2e.spec.ts) -- this suite upserts
// both to enabled values for its own duration and always restores them in `afterAll`, same discipline
// as magic-generate.e2e.spec.ts / magic-code.e2e.spec.ts / credentials.e2e.spec.ts.
let app: INestApplication;
let db: Database;
let http: ReturnType<typeof request>;
let magicCode: MagicCodeService;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const userIds: string[] = [];

async function setConfig(key: string, value: string) {
  await pool.query(
    `INSERT INTO instance_configurations (id, key, value, category, is_encrypted, created_at, updated_at)
     VALUES ($1, $2, $3, 'AUTHENTICATION', false, now(), now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [randomUUID(), key, value],
  );
}

async function getCsrf(): Promise<{ cookie: string; token: string }> {
  const res = await http.get("/auth/get-csrf-token");
  const setCookie = (res.headers["set-cookie"] as unknown as string[]) ?? [];
  const cookie = setCookie.find((c) => c.startsWith("csrftoken="))!.split(";")[0];
  return { cookie, token: res.body.csrf_token as string };
}

function email(tag: string) {
  return `magic-cred-${tag}-${randomUUID()}@test.dev`;
}

beforeAll(async () => {
  await setConfig("ENABLE_MAGIC_LINK_LOGIN", "1");
  await setConfig("EMAIL_HOST", "smtp.test.local");

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true }));
  await app.init();
  db = app.get<Database>(DRIZZLE);
  magicCode = app.get(MagicCodeService);
  http = request(app.getHttpServer());
});

afterAll(async () => {
  try {
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await app?.close();
  } finally {
    try {
      await setConfig("ENABLE_MAGIC_LINK_LOGIN", "0");
      await setConfig("EMAIL_HOST", "");
    } finally {
      await pool.end();
    }
  }
});

describe("Magic credentials — sign-in/up (redirect + CSRF parity)", () => {
  it("magic-sign-in: correct code + csrf -> 302 + session cookie, and bumps last_login_time", async () => {
    const addr = email("signin-ok");
    const id = randomUUID();
    userIds.push(id);
    const now = new Date();
    await db.insert(users).values({ id, email: addr, isActive: true, createdAt: now, updatedAt: now });
    const [before] = await db.select().from(users).where(eq(users.id, id));

    const { key, token } = await magicCode.initiate(addr);
    expect(key).toBe(`magic_${addr}`);

    const { cookie, token: csrf } = await getCsrf();
    const res = await http
      .post("/auth/magic-sign-in")
      .set("Cookie", cookie)
      .type("form")
      .send({ email: addr, code: token, csrfmiddlewaretoken: csrf });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000");
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith("session-id="))).toBe(true);

    const [after] = await db.select().from(users).where(eq(users.id, id));
    expect(after.lastLoginTime!.getTime()).toBeGreaterThan(before.lastLoginTime?.getTime() ?? 0);
  });

  it("magic-sign-in: wrong code -> 302 with error_code/error_message=INVALID_MAGIC_CODE_SIGN_IN", async () => {
    const addr = email("signin-wrong");
    const id = randomUUID();
    userIds.push(id);
    const now = new Date();
    await db.insert(users).values({ id, email: addr, isActive: true, createdAt: now, updatedAt: now });
    await magicCode.initiate(addr);

    const { cookie, token: csrf } = await getCsrf();
    const res = await http
      .post("/auth/magic-sign-in")
      .set("Cookie", cookie)
      .type("form")
      .send({ email: addr, code: "000000", csrfmiddlewaretoken: csrf });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`error_code=${AUTHENTICATION_ERROR_CODES.INVALID_MAGIC_CODE_SIGN_IN}`);
    expect(res.headers.location).toContain("error_message=INVALID_MAGIC_CODE_SIGN_IN");
  });

  it("magic-sign-in: missing code -> 302 with error_message=MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED", async () => {
    const addr = email("signin-missing");
    const { cookie, token: csrf } = await getCsrf();
    const res = await http
      .post("/auth/magic-sign-in")
      .set("Cookie", cookie)
      .type("form")
      .send({ email: addr, csrfmiddlewaretoken: csrf });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("error_message=MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED");
  });

  it("magic-sign-in: POST without a csrf token -> 403", async () => {
    const addr = email("signin-nocsrf");
    const res = await http.post("/auth/magic-sign-in").type("form").send({ email: addr, code: "123456" });
    expect(res.status).toBe(403);
  });

  it("magic-sign-up: new email + correct code -> creates a user with is_password_autoset=true, 302 + cookie", async () => {
    const addr = email("signup-new");
    const { token } = await magicCode.initiate(addr);

    const { cookie, token: csrf } = await getCsrf();
    const res = await http
      .post("/auth/magic-sign-up")
      .set("Cookie", cookie)
      .type("form")
      .send({ email: addr, code: token, csrfmiddlewaretoken: csrf });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000");
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith("session-id="))).toBe(true);

    const [created] = await db.select().from(users).where(eq(users.email, addr));
    expect(created).toBeDefined();
    userIds.push(created.id);
    expect(created.isPasswordAutoset).toBe(true);
    expect(created.password).toBeNull();
  });

  it("magic-sign-up: existing email -> 302 with error_message=USER_ALREADY_EXIST", async () => {
    const addr = email("signup-existing");
    const id = randomUUID();
    userIds.push(id);
    const now = new Date();
    await db.insert(users).values({ id, email: addr, isActive: true, createdAt: now, updatedAt: now });
    const { token } = await magicCode.initiate(addr);

    const { cookie, token: csrf } = await getCsrf();
    const res = await http
      .post("/auth/magic-sign-up")
      .set("Cookie", cookie)
      .type("form")
      .send({ email: addr, code: token, csrfmiddlewaretoken: csrf });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`error_code=${AUTHENTICATION_ERROR_CODES.USER_ALREADY_EXIST}`);
    expect(res.headers.location).toContain("error_message=USER_ALREADY_EXIST");
  });
});
