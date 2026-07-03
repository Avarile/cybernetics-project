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
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AUTHENTICATION_ERROR_CODES } from "../src/infra/auth/error-codes";
import { makeDjangoPassword } from "../src/infra/auth/django-password";
import { DRIZZLE, type Database } from "../src/infra/database/drizzle.module";
import { users } from "../src/infra/database/schema";

// Faithful port of views/app/email.py (SignInAuthEndpoint/SignUpAuthEndpoint) + views/app/signout.py:
// form-POST -> 302-redirect protocol, CSRF-guarded. Seeds/cleans its own user rows against plane_test.
const PASSWORD = "Tr0ub4dor&3xyz";

let app: INestApplication;
let db: Database;
let http: ReturnType<typeof request>;

const signInEmail = `credentials-signin-${randomUUID()}@test.dev`;
const userIds: string[] = [];

async function getCsrf(): Promise<{ cookie: string; token: string }> {
  const res = await http.get("/auth/get-csrf-token");
  const setCookie = (res.headers["set-cookie"] as unknown as string[]) ?? [];
  const cookie = setCookie.find((c) => c.startsWith("csrftoken="))!.split(";")[0];
  return { cookie, token: res.body.csrf_token as string };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true }));
  await app.init();
  db = app.get<Database>(DRIZZLE);
  http = request(app.getHttpServer());

  // Seed/reset the sign-in test user with a known password hash.
  await db.delete(users).where(eq(users.email, signInEmail));
  const id = randomUUID();
  userIds.push(id);
  const now = new Date();
  await db.insert(users).values({
    id,
    email: signInEmail,
    password: makeDjangoPassword(PASSWORD),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => {
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  await app?.close();
});

describe("Credentials — sign-in/up/out (redirect + CSRF parity)", () => {
  it("sign-up: form-POST with a strong password + csrf -> 302 to APP_BASE_URL with a session cookie", async () => {
    const { cookie, token } = await getCsrf();
    const email = `credentials-signup-${randomUUID()}@test.dev`;
    const res = await http
      .post("/auth/sign-up")
      .set("Cookie", cookie)
      .type("form")
      .send({ email, password: PASSWORD, csrfmiddlewaretoken: token });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000");
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith("session-id="))).toBe(true);

    const [created] = await db.select().from(users).where(eq(users.email, email));
    expect(created).toBeDefined();
    userIds.push(created.id);
    // recordLogin ran on sign-up too, on top of signUp()'s own initial last_login_time write.
    expect(created.lastLoginIp).toBeTruthy();
    expect(created.tokenUpdatedAt).not.toBeNull();
  });

  it("sign-in: wrong password -> 302 with error_code/error_message=AUTHENTICATION_FAILED_SIGN_IN", async () => {
    const { cookie, token } = await getCsrf();
    const res = await http
      .post("/auth/sign-in")
      .set("Cookie", cookie)
      .type("form")
      .send({ email: signInEmail, password: "wrong-password", csrfmiddlewaretoken: token });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`error_code=${AUTHENTICATION_ERROR_CODES.AUTHENTICATION_FAILED_SIGN_IN}`);
    expect(res.headers.location).toContain("error_message=AUTHENTICATION_FAILED_SIGN_IN");
  });

  it("POST without a csrf token -> 403", async () => {
    const res = await http.post("/auth/sign-in").type("form").send({ email: signInEmail, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it("sign-in: correct credentials -> 302 + session cookie, honors an explicit next_path, and runs recordLogin", async () => {
    const [before] = await db.select().from(users).where(eq(users.id, userIds[0]));

    const { cookie, token } = await getCsrf();
    const res = await http
      .post("/auth/sign-in")
      .set("Cookie", cookie)
      .type("form")
      .send({ email: signInEmail, password: PASSWORD, next_path: "/workspace-slug", csrfmiddlewaretoken: token });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/?next_path=%2Fworkspace-slug");
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith("session-id="))).toBe(true);

    const [after] = await db.select().from(users).where(eq(users.id, userIds[0]));
    expect(after.lastLoginTime!.getTime()).toBeGreaterThan(before.lastLoginTime?.getTime() ?? 0);
    expect(after.lastLoginIp).toBeTruthy();
    expect(after.lastLoginMedium).toBe("email");
    expect(after.tokenUpdatedAt!.getTime()).toBeGreaterThan(before.tokenUpdatedAt?.getTime() ?? 0);
  });

  it("sign-out: destroys the session, clears the cookie, redirects to base, and records last_logout_ip/time", async () => {
    const [before] = await db.select().from(users).where(eq(users.id, userIds[0]));

    const signinCsrf = await getCsrf();
    const signin = await http
      .post("/auth/sign-in")
      .set("Cookie", signinCsrf.cookie)
      .type("form")
      .send({ email: signInEmail, password: PASSWORD, csrfmiddlewaretoken: signinCsrf.token });
    const sessionCookie = (signin.headers["set-cookie"] as unknown as string[])
      .find((c) => c.startsWith("session-id="))!
      .split(";")[0];

    const signoutCsrf = await getCsrf();
    const res = await http
      .post("/auth/sign-out")
      .set("Cookie", [sessionCookie, signoutCsrf.cookie].join("; "))
      .type("form")
      .send({ csrfmiddlewaretoken: signoutCsrf.token });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000");
    const cleared = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("session-id="));
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    const [after] = await db.select().from(users).where(eq(users.id, userIds[0]));
    expect(after.lastLogoutTime).not.toBeNull();
    expect(after.lastLogoutTime!.getTime()).toBeGreaterThan(before.lastLogoutTime?.getTime() ?? 0);
    expect(after.lastLogoutIp).toBeTruthy();
    // sign-out never deactivates the account.
    expect(after.isActive).toBe(true);
  });
});
