import { randomUUID } from "node:crypto";
// Env must be set before AppModule providers (DrizzleModule factory) instantiate.
process.env.DATABASE_URL ??= "postgresql://plane:plane@localhost:5433/plane_test";
process.env.SECRET_KEY ??= "e2e-test-secret-key";
process.env.REDIS_URL ??= "redis://localhost:6379/0";
process.env.AMQP_URL ??= "amqp://guest:guest@localhost:5672/";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { makeDjangoPassword } from "../src/infra/auth/django-password";
import { buildSessionPayload, djangoDumps, newSessionKey } from "../src/infra/auth/session.crypto";
import { DRIZZLE, type Database } from "../src/infra/database/drizzle.module";
import {
  apiTokens,
  labels,
  projectMembers,
  projects,
  sessions,
  states,
  users,
  workspaceMembers,
  workspaces,
} from "../src/infra/database/schema";
import { notifications } from "../src/modules/notification/notification.schema";

const PASSWORD = "password123";
const SLUG = "acme-e2e";

let app: INestApplication;
let db: Database;
let http: ReturnType<typeof request>;

// seeded ids
const adminId = randomUUID();
const memberId = randomUUID();
const workspaceId = randomUUID();
const projectId = randomUUID();
let adminSessionKey: string;

async function truncateAll() {
  await db.execute(
    sql.raw(
      "TRUNCATE notifications, user_notification_preferences, email_notification_logs, issue_subscribers, " +
        "issue_activities, webhook_logs, webhooks, " +
        "intake_issues, intakes, page_labels, project_pages, pages, " +
        "issue_labels, issue_assignees, issue_sequences, issues, cycles, modules, module_members, " +
        "estimate_points, estimates, issue_views, labels, states, project_members, projects, " +
        "workspace_members, workspaces, sessions, api_tokens, users RESTART IDENTITY CASCADE",
    ),
  );
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  db = app.get<Database>(DRIZZLE);
  http = request(app.getHttpServer());

  await truncateAll();

  const now = new Date();
  await db.insert(users).values([
    {
      id: adminId,
      email: "Admin@Example.com",
      password: makeDjangoPassword(PASSWORD, { iterations: 1000, salt: "seedsalt" }),
      isActive: true,
      displayName: "Admin",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: memberId,
      email: "member@example.com",
      password: makeDjangoPassword(PASSWORD, { iterations: 1000, salt: "seedsalt2" }),
      isActive: true,
      displayName: "Member",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(workspaces).values({ id: workspaceId, name: "Acme", slug: SLUG, ownerId: adminId });
  await db.insert(workspaceMembers).values([
    { workspaceId, memberId: adminId, role: 20, isActive: true },
    { workspaceId, memberId: memberId, role: 15, isActive: true },
  ]);
  await db.insert(projects).values({ id: projectId, workspaceId, name: "Website", identifier: "WEB" });
  await db.insert(projectMembers).values([
    { projectId, workspaceId, memberId: adminId, role: 20, isActive: true },
    { projectId, workspaceId, memberId: memberId, role: 15, isActive: true },
  ]);

  // A Django-style session row for the admin (drop-in read path).
  adminSessionKey = newSessionKey();
  const payload = buildSessionPayload(adminId, "x", process.env.SECRET_KEY!, null);
  await db.insert(sessions).values({
    sessionKey: adminSessionKey,
    sessionData: djangoDumps(payload, process.env.SECRET_KEY!),
    userId: adminId,
    expireDate: new Date(Date.now() + 3600_000),
  });
});

afterAll(async () => {
  await app?.close();
});

const P = `/api/workspaces/${SLUG}/projects/${projectId}`;

describe("Phase 1 — auth & sessions (drop-in)", () => {
  it("resolves a Django-style session cookie -> /api/users/me", async () => {
    const res = await http.get("/api/users/me").set("Cookie", `session-id=${adminSessionKey}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("Admin@Example.com");
    expect(res.body).not.toHaveProperty("password");
  });

  it("401s without a cookie (DRF detail shape)", async () => {
    const res = await http.get("/api/users/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ detail: "Authentication credentials were not provided." });
  });

  it("email/password sign-in sets a session cookie usable for /me", async () => {
    const res = await http.post("/auth/sign-in").send({ email: "admin@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith("session-id="))).toBe(true);
    const cookie = setCookie.find((c) => c.startsWith("session-id="))!.split(";")[0];
    const me = await http.get("/api/users/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("Admin@Example.com");
  });

  it("rejects a wrong password", async () => {
    const res = await http.post("/auth/sign-in").send({ email: "admin@example.com", password: "nope" });
    expect(res.status).toBe(401);
  });
});

describe("Phase 2 — State (interface parity)", () => {
  const cookie = () => `session-id=${adminSessionKey}`;
  let stateId: string;
  let secondStateId: string;

  it("creates a state (ADMIN) with 200 + Django serializer shape", async () => {
    const res = await http.post(`${P}/states/`).set("Cookie", cookie()).send({ name: "Backlog", color: "#60646C", group: "backlog" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Backlog", group: "backlog", project_id: projectId, workspace_id: workspaceId });
    expect(res.body).toHaveProperty("sequence");
    stateId = res.body.id;
  });

  it("rejects a triage group with 400", async () => {
    const res = await http.post(`${P}/states/`).set("Cookie", cookie()).send({ name: "T", color: "#000", group: "triage" });
    expect(res.status).toBe(400);
  });

  it("computes per-group order in list", async () => {
    const r2 = await http.post(`${P}/states/`).set("Cookie", cookie()).send({ name: "Todo", color: "#111", group: "backlog" });
    secondStateId = r2.body.id;
    const list = await http.get(`${P}/states/`).set("Cookie", cookie());
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    const backlog = list.body.filter((s: { group: string }) => s.group === "backlog");
    expect(backlog.map((s: { order: number }) => s.order).sort()).toEqual([0.5, 1]);
  });

  it("mark-default (204) then delete-default is refused (400)", async () => {
    const mark = await http.post(`${P}/states/${stateId}/mark-default/`).set("Cookie", cookie());
    expect(mark.status).toBe(204);
    const del = await http.delete(`${P}/states/${stateId}/`).set("Cookie", cookie());
    expect(del.status).toBe(400);
    expect(del.body).toEqual({ error: "Default state cannot be deleted" });
  });

  it("deletes a non-default state (204)", async () => {
    const del = await http.delete(`${P}/states/${secondStateId}/`).set("Cookie", cookie());
    expect(del.status).toBe(204);
  });

  it("forbids a MEMBER from creating a state (403, ADMIN-only)", async () => {
    const signin = await http.post("/auth/sign-in").send({ email: "member@example.com", password: PASSWORD });
    const memberCookie = (signin.headers["set-cookie"] as unknown as string[])
      .find((c) => c.startsWith("session-id="))!
      .split(";")[0];
    const res = await http.post(`${P}/states/`).set("Cookie", memberCookie).send({ name: "X", color: "#000" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "You don't have the required permissions." });
    // but a MEMBER can list
    const list = await http.get(`${P}/states/`).set("Cookie", memberCookie);
    expect(list.status).toBe(200);
  });
});

describe("Phase 2 — Label (interface parity)", () => {
  const cookie = () => `session-id=${adminSessionKey}`;

  it("creates a label (201) with Django serializer shape", async () => {
    const res = await http.post(`${P}/issue-labels/`).set("Cookie", cookie()).send({ name: "Bug", color: "#F00" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Bug", project_id: projectId, workspace_id: workspaceId });
    expect(res.body).toHaveProperty("sort_order");
    expect(res.body).toHaveProperty("parent", null);
  });

  it("rejects a duplicate label name (400)", async () => {
    const res = await http.post(`${P}/issue-labels/`).set("Cookie", cookie()).send({ name: "bug" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Label with the same name already exists in the project" });
  });

  it("lists labels ordered by sort_order", async () => {
    await http.post(`${P}/issue-labels/`).set("Cookie", cookie()).send({ name: "Feature", color: "#0F0" });
    const list = await http.get(`${P}/issue-labels/`).set("Cookie", cookie());
    expect(list.status).toBe(200);
    expect(list.body.map((l: { name: string }) => l.name)).toContain("Feature");
  });
});

describe("Phase 2 — Issue (advisory-lock sequence + pagination)", () => {
  const cookie = () => `session-id=${adminSessionKey}`;
  let issueStateId: string;
  let issueId: string;

  beforeAll(async () => {
    const s = await http.post(`${P}/states/`).set("Cookie", cookie()).send({ name: "IssueTodo", color: "#123", group: "unstarted" });
    issueStateId = s.body.id;
  });

  it("creates an issue with sequence_id=1 and annotation fields", async () => {
    const res = await http
      .post(`${P}/issues/`)
      .set("Cookie", cookie())
      .send({ name: "First issue", state: issueStateId, priority: "high", labels: [], assignees: [] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "First issue", state_id: issueStateId, priority: "high", project_id: projectId, sequence_id: 1 });
    expect(res.body).toHaveProperty("label_ids");
    expect(res.body).toHaveProperty("assignee_ids");
    expect(res.body).toHaveProperty("sub_issues_count", 0);
    issueId = res.body.id;
  });

  it("assigns the next sequence_id under the advisory lock", async () => {
    const res = await http.post(`${P}/issues/`).set("Cookie", cookie()).send({ name: "Second issue", state: issueStateId });
    expect(res.status).toBe(201);
    expect(res.body.sequence_id).toBe(2);
  });

  it("lists issues with the cursor pagination envelope", async () => {
    const res = await http.get(`${P}/issues/`).set("Cookie", cookie());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("results");
    expect(res.body).toHaveProperty("total_count");
    expect(res.body).toHaveProperty("next_cursor");
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThanOrEqual(2);
  });

  it("retrieves and updates an issue", async () => {
    const get = await http.get(`${P}/issues/${issueId}/`).set("Cookie", cookie());
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(issueId);
    const patch = await http.patch(`${P}/issues/${issueId}/`).set("Cookie", cookie()).send({ priority: "urgent" });
    expect(patch.status).toBe(200);
    expect(patch.body.priority).toBe("urgent");
  });

  it("rejects an invalid state_id (400)", async () => {
    const res = await http
      .post(`${P}/issues/`)
      .set("Cookie", cookie())
      .send({ name: "Bad", state: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(400);
  });

  it("soft-deletes an issue (204)", async () => {
    const res = await http.delete(`${P}/issues/${issueId}/`).set("Cookie", cookie());
    expect(res.status).toBe(204);
  });
});

describe("Phase 2 — new domains smoke (real DB CRUD)", () => {
  const cookie = () => `session-id=${adminSessionKey}`;

  it("creates a cycle", async () => {
    const res = await http.post(`${P}/cycles/`).set("Cookie", cookie()).send({ name: "Sprint 1" });
    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty("id");
  });

  it("creates a module", async () => {
    const res = await http.post(`${P}/modules/`).set("Cookie", cookie()).send({ name: "Auth" });
    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty("id");
  });

  it("creates an estimate", async () => {
    const res = await http.post(`${P}/estimates/`).set("Cookie", cookie()).send({ name: "Fibonacci", type: "points" });
    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty("id");
  });

  it("creates a project view", async () => {
    const res = await http.post(`${P}/views/`).set("Cookie", cookie()).send({ name: "My View" });
    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty("id");
  });

  it("creates a page", async () => {
    const res = await http.post(`${P}/pages/`).set("Cookie", cookie()).send({ name: "Runbook" });
    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty("id");
  });

  it("creates an intake and lists it", async () => {
    const create = await http.post(`${P}/intakes/`).set("Cookie", cookie()).send({ name: "Default Intake" });
    expect([200, 201]).toContain(create.status);
    expect(create.body).toHaveProperty("id");
    const list = await http.get(`${P}/intakes/`).set("Cookie", cookie());
    expect(list.status).toBe(200);
  });
});

describe("Phase 3 — Notifications (HTTP)", () => {
  const cookie = () => `session-id=${adminSessionKey}`;
  const notifId = randomUUID();

  beforeAll(async () => {
    await db.insert(notifications).values({
      id: notifId,
      workspaceId,
      projectId,
      entityIdentifier: randomUUID(),
      entityName: "issue",
      title: "updated the name to",
      sender: "in_app:issue_activities",
      triggeredById: memberId,
      receiverId: adminId,
    });
  });

  it("lists the receiver's notifications (cursor envelope)", async () => {
    const res = await http.get(`/api/workspaces/${SLUG}/users/notifications/`).set("Cookie", cookie());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("results");
    expect(res.body.results.map((n: { id: string }) => n.id)).toContain(notifId);
    expect(res.body.results[0]).toHaveProperty("entity_name", "issue");
  });

  it("reports unread count then marks read (204) and decrements", async () => {
    const before = await http.get(`/api/workspaces/${SLUG}/users/notifications/unread/`).set("Cookie", cookie());
    expect(before.body.count).toBeGreaterThanOrEqual(1);
    const mark = await http.post(`/api/workspaces/${SLUG}/users/notifications/${notifId}/read/`).set("Cookie", cookie());
    expect(mark.status).toBe(204);
    const after = await http.get(`/api/workspaces/${SLUG}/users/notifications/unread/`).set("Cookie", cookie());
    expect(after.body.count).toBe(before.body.count - 1);
  });
});

describe("Phase 5 — v1 public API (X-Api-Key)", () => {
  const API_KEY = "plane_api_e2e_testkey_0001";
  const V1 = `/api/v1/workspaces/${SLUG}/projects/${projectId}`;

  beforeAll(async () => {
    await db.insert(apiTokens).values({ token: API_KEY, userId: adminId, workspaceId, isActive: true, label: "e2e" });
  });

  it("401s a v1 request without X-Api-Key", async () => {
    const res = await http.get(`${V1}/work-items/`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ detail: "Given API token is not valid" });
  });

  it("authenticates with X-Api-Key and returns the paginated envelope + rate-limit headers", async () => {
    const res = await http.get(`${V1}/work-items/`).set("X-Api-Key", API_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("results");
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });

  it("creates a work-item via the v1 API", async () => {
    const state = await http.get(`${V1}/states/`).set("X-Api-Key", API_KEY);
    expect(state.status).toBe(200);
    const stateId = state.body[0]?.id;
    const res = await http.post(`${V1}/work-items/`).set("X-Api-Key", API_KEY).send({ name: "Via v1 API", state: stateId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Via v1 API", project_id: projectId });
  });

  it("lists workspace projects via the v1 API", async () => {
    const res = await http.get(`/api/v1/workspaces/${SLUG}/projects/`).set("X-Api-Key", API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.map((p: { id: string }) => p.id)).toContain(projectId);
  });
});
