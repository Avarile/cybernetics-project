// Env must be set before AppModule providers (DrizzleModule factory) instantiate.
process.env.DATABASE_URL ??= "postgresql://plane:plane@localhost:5433/plane_test";
process.env.SECRET_KEY ??= "e2e-test-secret-key";
process.env.REDIS_URL ??= "redis://localhost:6379/0";
process.env.AMQP_URL ??= "amqp://guest:guest@localhost:5672/";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.WEB_URL ??= "http://localhost:3000";
process.env.SPACE_BASE_URL ??= "http://localhost:3002";

import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { makeDjangoPassword } from "../src/infra/auth/django-password";
import { DRIZZLE, type Database } from "../src/infra/database/drizzle.module";
import { users } from "../src/infra/database/schema";

// Faithful port of views/space/email.py (SignInAuthEndpoint/SignUpAuthEndpoint) +
// views/space/signout.py: same form-POST -> 302-redirect protocol as the app variant
// (credentials.e2e.spec.ts), only the redirect target (SPACE_BASE_URL) differs.
const PASSWORD = "Tr0ub4dor&3xyz";

let app: INestApplication;
let db: Database;
let http: ReturnType<typeof request>;

const signInEmail = `credentials-space-signin-${randomUUID()}@test.dev`;
const userIds: string[] = [];

async function getCsrf(): Promise<{ cookie: string; token: string }> {
  const res = await http.get("/auth/spaces/get-csrf-token");
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

describe("Credentials (spaces) — sign-in/up/out (redirect + CSRF parity)", () => {
  it("sign-up: form-POST with a strong password + csrf -> 302 to SPACE_BASE_URL with a session cookie", async () => {
    const { cookie, token } = await getCsrf();
    const email = `credentials-space-signup-${randomUUID()}@test.dev`;
    const res = await http
      .post("/auth/spaces/sign-up")
      .set("Cookie", cookie)
      .type("form")
      .send({ email, password: PASSWORD, csrfmiddlewaretoken: token });

    expect(res.status).toBe(302);
    expect(res.headers.location.startsWith("http://localhost:3002")).toBe(true);
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith("session-id="))).toBe(true);

    const [created] = await db.select().from(users).where(eq(users.email, email));
    expect(created).toBeDefined();
    userIds.push(created.id);
  });

  it("sign-in: correct credentials -> 302 to SPACE_BASE_URL + session cookie", async () => {
    const { cookie, token } = await getCsrf();
    const res = await http
      .post("/auth/spaces/sign-in")
      .set("Cookie", cookie)
      .type("form")
      .send({ email: signInEmail, password: PASSWORD, csrfmiddlewaretoken: token });

    expect(res.status).toBe(302);
    expect(res.headers.location.startsWith("http://localhost:3002")).toBe(true);
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith("session-id="))).toBe(true);
  });

  it("sign-out: destroys the session, clears the cookie, and redirects to SPACE_BASE_URL", async () => {
    const signinCsrf = await getCsrf();
    const signin = await http
      .post("/auth/spaces/sign-in")
      .set("Cookie", signinCsrf.cookie)
      .type("form")
      .send({ email: signInEmail, password: PASSWORD, csrfmiddlewaretoken: signinCsrf.token });
    const sessionCookie = (signin.headers["set-cookie"] as unknown as string[])
      .find((c) => c.startsWith("session-id="))!
      .split(";")[0];

    const signoutCsrf = await getCsrf();
    const res = await http
      .post("/auth/spaces/sign-out")
      .set("Cookie", [sessionCookie, signoutCsrf.cookie].join("; "))
      .type("form")
      .send({ csrfmiddlewaretoken: signoutCsrf.token });

    expect(res.status).toBe(302);
    // baseHost(cfg, "space") appends SPACE_BASE_PATH (default "/spaces/") to SPACE_BASE_URL, unlike
    // the app audience which redirects to the bare APP_BASE_URL -- see infra/auth/redirect.ts.
    expect(res.headers.location).toBe("http://localhost:3002/spaces");
    const cleared = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("session-id="));
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("POST without a csrf token -> 403", async () => {
    const res = await http
      .post("/auth/spaces/sign-in")
      .type("form")
      .send({ email: signInEmail, password: PASSWORD });
    expect(res.status).toBe(403);
  });
});
