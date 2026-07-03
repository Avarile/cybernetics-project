import { randomUUID } from "node:crypto";
// Env must be set before AppModule providers instantiate.
process.env.DATABASE_URL ??= "postgresql://plane:plane@localhost:5433/plane_test";
process.env.SECRET_KEY ??= "e2e-test-secret-key";
process.env.REDIS_URL ??= "redis://localhost:6379/0";
process.env.AMQP_URL ??= "amqp://guest:guest@localhost:5672/";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { makeDjangoPassword } from "../src/infra/auth/django-password";
import { buildSessionPayload, djangoDumps, newSessionKey } from "../src/infra/auth/session.crypto";
import { DRIZZLE, type Database } from "../src/infra/database/drizzle.module";
import { projectMembers, projects, sessions, users, workspaceMembers, workspaces } from "../src/infra/database/schema";
import { cycleIssues, cycles } from "../src/modules/cycle/cycle.schema";
import { issueAssignees, issueLabels, issues } from "../src/modules/issue/issue.schema";
import { labels } from "../src/modules/label/label.schema";
import { moduleIssues, modules } from "../src/modules/project-module/module.schema";
import { states } from "../src/modules/state/state.schema";

const N = 20;
const ADMIN = 20, MEMBER = 15, GUEST = 5;
const GROUPS = ["backlog", "unstarted", "started", "completed", "cancelled"] as const;

let app: INestApplication;
let db: Database;
let http: ReturnType<typeof request>;

// entities
const U = Array.from({ length: N }, () => randomUUID());
const wsA = randomUUID(), wsB = randomUUID();
const A_SLUG = "seed-alpha", B_SLUG = "seed-beta";
const A1 = randomUUID(), A2 = randomUUID(), A3 = randomUUID(), B1 = randomUUID(), B2 = randomUUID();
const skey: string[] = [];
const stateMap: Record<string, Record<string, string>> = {}; // projectId -> group -> stateId
const acCycle = randomUUID(), amModule = randomUUID();
const cookie = (i: number) => `session-id=${skey[i]}`;

async function truncate() {
  await db.execute(
    sql.raw(
      "TRUNCATE users, workspaces, workspace_members, projects, project_members, states, labels, " +
        "issues, issue_assignees, issue_labels, cycles, cycle_issues, modules, module_issues, sessions, analytic_views CASCADE",
    ),
  );
}

function seedStates(projectId: string, wsId: string) {
  stateMap[projectId] = {};
  const rows = GROUPS.map((g, idx) => {
    const id = randomUUID();
    stateMap[projectId][g] = id;
    return { id, workspaceId: wsId, projectId, name: g, group: g, sequence: (idx + 1) * 1000, color: "#334155" };
  });
  return rows;
}

interface Spec {
  group: (typeof GROUPS)[number];
  priority: string;
  count: number;
  assignee?: string;
  completed?: boolean;
}
function buildIssues(projectId: string, wsId: string, createdBy: string, specs: Spec[], now: Date) {
  const issueRows: Array<Record<string, unknown>> = [];
  const assigneeRows: Array<Record<string, unknown>> = [];
  let n = 0;
  for (const s of specs) {
    for (let k = 0; k < s.count; k++) {
      const id = randomUUID();
      issueRows.push({
        id,
        name: `${projectId.slice(0, 4)}-${s.group}-${n++}`,
        workspaceId: wsId,
        projectId,
        createdBy,
        stateId: stateMap[projectId][s.group],
        priority: s.priority,
        completedAt: s.completed ? now : null,
      });
      if (s.assignee) assigneeRows.push({ issueId: id, assigneeId: s.assignee, workspaceId: wsId, projectId });
    }
  }
  return { issueRows, assigneeRows };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  db = app.get<Database>(DRIZZLE);
  http = request(app.getHttpServer());

  await truncate();

  const now = new Date();
  // 20 users
  await db.insert(users).values(
    U.map((id, i) => ({
      id,
      email: `user${i}@seed.test`,
      password: makeDjangoPassword("pass12345", { iterations: 1000, salt: `s${i}` }),
      isActive: true,
      displayName: `User ${i}`,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      createdAt: now,
      updatedAt: now,
    })),
  );

  // workspaces + members
  await db.insert(workspaces).values([
    { id: wsA, name: "Alpha", slug: A_SLUG, ownerId: U[0] },
    { id: wsB, name: "Beta", slug: B_SLUG, ownerId: U[12] },
  ]);
  await db.insert(workspaceMembers).values([
    { workspaceId: wsA, memberId: U[0], role: ADMIN, isActive: true },
    { workspaceId: wsA, memberId: U[1], role: MEMBER, isActive: true },
    { workspaceId: wsA, memberId: U[2], role: MEMBER, isActive: true },
    { workspaceId: wsA, memberId: U[3], role: GUEST, isActive: true },
    { workspaceId: wsA, memberId: U[4], role: MEMBER, isActive: true },
    { workspaceId: wsA, memberId: U[5], role: MEMBER, isActive: true },
    { workspaceId: wsA, memberId: U[6], role: MEMBER, isActive: true },
    { workspaceId: wsA, memberId: U[7], role: MEMBER, isActive: true },
    { workspaceId: wsA, memberId: U[8], role: MEMBER, isActive: true }, // in no project
    { workspaceId: wsA, memberId: U[9], role: MEMBER, isActive: true },
    { workspaceId: wsA, memberId: U[10], role: MEMBER, isActive: true },
    { workspaceId: wsA, memberId: U[11], role: MEMBER, isActive: true },
    { workspaceId: wsB, memberId: U[12], role: ADMIN, isActive: true },
    { workspaceId: wsB, memberId: U[13], role: MEMBER, isActive: true },
    { workspaceId: wsB, memberId: U[14], role: ADMIN, isActive: true },
    { workspaceId: wsB, memberId: U[15], role: MEMBER, isActive: true },
    ...[16, 17, 18, 19].map((i) => ({ workspaceId: wsB, memberId: U[i], role: MEMBER, isActive: true })),
  ]);

  // projects + members
  await db.insert(projects).values([
    { id: A1, workspaceId: wsA, name: "A1", identifier: "A1" },
    { id: A2, workspaceId: wsA, name: "A2", identifier: "A2" },
    { id: A3, workspaceId: wsA, name: "A3", identifier: "A3" },
    { id: B1, workspaceId: wsB, name: "B1", identifier: "B1" },
    { id: B2, workspaceId: wsB, name: "B2", identifier: "B2" },
  ]);
  await db.insert(projectMembers).values([
    { projectId: A1, workspaceId: wsA, memberId: U[0], role: ADMIN, isActive: true },
    { projectId: A1, workspaceId: wsA, memberId: U[1], role: MEMBER, isActive: true },
    { projectId: A1, workspaceId: wsA, memberId: U[2], role: MEMBER, isActive: true },
    { projectId: A1, workspaceId: wsA, memberId: U[3], role: GUEST, isActive: true },
    { projectId: A2, workspaceId: wsA, memberId: U[0], role: ADMIN, isActive: true },
    { projectId: A2, workspaceId: wsA, memberId: U[4], role: MEMBER, isActive: true },
    { projectId: A2, workspaceId: wsA, memberId: U[5], role: MEMBER, isActive: true },
    { projectId: A3, workspaceId: wsA, memberId: U[6], role: ADMIN, isActive: true },
    { projectId: A3, workspaceId: wsA, memberId: U[7], role: MEMBER, isActive: true },
    { projectId: B1, workspaceId: wsB, memberId: U[12], role: ADMIN, isActive: true },
    { projectId: B1, workspaceId: wsB, memberId: U[13], role: MEMBER, isActive: true },
    { projectId: B2, workspaceId: wsB, memberId: U[14], role: ADMIN, isActive: true },
    { projectId: B2, workspaceId: wsB, memberId: U[15], role: MEMBER, isActive: true },
  ]);

  // states + labels for every project
  const allStates = [seedStates(A1, wsA), seedStates(A2, wsA), seedStates(A3, wsA), seedStates(B1, wsB), seedStates(B2, wsB)].flat();
  await db.insert(states).values(allStates);
  await db.insert(labels).values(
    [A1, A2, A3, B1, B2].flatMap((p, idx) => {
      const wsId = idx < 3 ? wsA : wsB;
      return [
        { id: randomUUID(), workspaceId: wsId, projectId: p, name: "bug", color: "#ef4444" },
        { id: randomUUID(), workspaceId: wsId, projectId: p, name: "feat", color: "#22c55e" },
      ];
    }),
  );

  // issues: A1=12, A2=8, A3=6, B1=4, B2=3
  const a1 = buildIssues(A1, wsA, U[0], [
    { group: "backlog", priority: "high", count: 3 },
    { group: "unstarted", priority: "medium", count: 2 },
    { group: "started", priority: "low", count: 2, assignee: U[1] },
    { group: "completed", priority: "urgent", count: 4, assignee: U[1], completed: true },
    { group: "cancelled", priority: "none", count: 1 },
  ], now);
  const a2 = buildIssues(A2, wsA, U[0], [
    { group: "backlog", priority: "high", count: 5 },
    { group: "completed", priority: "low", count: 3, completed: true },
  ], now);
  const a3 = buildIssues(A3, wsA, U[6], [
    { group: "backlog", priority: "medium", count: 3 },
    { group: "completed", priority: "high", count: 3, completed: true },
  ], now);
  const b1 = buildIssues(B1, wsB, U[12], [
    { group: "backlog", priority: "high", count: 2 },
    { group: "completed", priority: "low", count: 2, completed: true },
  ], now);
  const b2 = buildIssues(B2, wsB, U[14], [{ group: "backlog", priority: "none", count: 3 }], now);

  const allIssues = [a1, a2, a3, b1, b2];
  await db.insert(issues).values(allIssues.flatMap((x) => x.issueRows) as never);
  const allAssignees = allIssues.flatMap((x) => x.assigneeRows);
  if (allAssignees.length) await db.insert(issueAssignees).values(allAssignees as never);

  // one label on the first A1 issue
  await db.insert(issueLabels).values({
    issueId: a1.issueRows[0].id as string,
    labelId: (await db.select({ id: labels.id }).from(labels).where(sql`${labels.projectId} = ${A1}`).limit(1))[0].id,
    workspaceId: wsA,
    projectId: A1,
  });

  // cycle on A1 spanning now (window ±5d); add 3 A1 issues (2 completed + 1 backlog)
  const day = 86_400_000;
  await db.insert(cycles).values({
    id: acCycle,
    workspaceId: wsA,
    projectId: A1,
    name: "Sprint 1",
    ownedBy: U[0],
    startDate: new Date(now.getTime() - 5 * day),
    endDate: new Date(now.getTime() + 5 * day),
  });
  const a1Completed = a1.issueRows.filter((r) => r.completedAt).slice(0, 2);
  const a1Backlog = a1.issueRows.filter((r) => r.stateId === stateMap[A1].backlog).slice(0, 1);
  await db.insert(cycleIssues).values(
    [...a1Completed, ...a1Backlog].map((r) => ({ issueId: r.id as string, cycleId: acCycle, workspaceId: wsA, projectId: A1 })),
  );

  // module on A1; add 2 A1 issues
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  await db.insert(modules).values({
    id: amModule,
    workspaceId: wsA,
    projectId: A1,
    name: "Module 1",
    startDate: ymd(new Date(now.getTime() - 5 * day)),
    targetDate: ymd(new Date(now.getTime() + 5 * day)),
  });
  await db.insert(moduleIssues).values(
    a1.issueRows.slice(0, 2).map((r) => ({ issueId: r.id as string, moduleId: amModule, workspaceId: wsA, projectId: A1 })),
  );

  // sessions for all 20 users
  for (let i = 0; i < N; i++) {
    const key = newSessionKey();
    skey.push(key);
    await db.insert(sessions).values({
      sessionKey: key,
      sessionData: djangoDumps(buildSessionPayload(U[i], "x", process.env.SECRET_KEY!, null), process.env.SECRET_KEY!),
      userId: U[i],
      expireDate: new Date(Date.now() + 3600_000),
    });
  }
});

afterAll(async () => {
  await app?.close();
});

const A = `/api/workspaces/${A_SLUG}`;

describe("Seed smoke — 20 users, multi-workspace/project graph", () => {
  it("session auth: GET /api/users/me works for a seeded user", async () => {
    const res = await http.get("/api/users/me").set("Cookie", cookie(0));
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("user0@seed.test");
  });

  it("core reads: states/labels/cycles/modules/issues for project A1", async () => {
    const base = `${A}/projects/${A1}`;
    const [st, lb, cy, mo, iss] = await Promise.all([
      http.get(`${base}/states/`).set("Cookie", cookie(0)),
      http.get(`${base}/issue-labels/`).set("Cookie", cookie(0)),
      http.get(`${base}/cycles/`).set("Cookie", cookie(0)),
      http.get(`${base}/modules/`).set("Cookie", cookie(0)),
      http.get(`${base}/issues/`).set("Cookie", cookie(0)),
    ]);
    expect(st.status).toBe(200);
    expect(st.body.length).toBe(5);
    expect(lb.status).toBe(200);
    expect(lb.body.length).toBe(2);
    expect(cy.status).toBe(200);
    expect(cy.body.length).toBe(1);
    expect(mo.status).toBe(200);
    expect(mo.body.length).toBe(1);
    expect(iss.status).toBe(200);
  });

  // ---- classic analytics (workspace-scoped, admin) ----

  it("classic /analytics is workspace-scoped (all 26 issues across A1+A2+A3)", async () => {
    const res = await http.get(`${A}/analytics/?x_axis=priority&y_axis=issue_count`).set("Cookie", cookie(0));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(26);
  });

  it("classic /default-analytics + /project-stats", async () => {
    const def = await http.get(`${A}/default-analytics/`).set("Cookie", cookie(0));
    expect(def.status).toBe(200);
    expect(def.body.total_issues).toBe(26);
    const stats = await http.get(`${A}/project-stats/?fields=total_issues,completed_issues`).set("Cookie", cookie(0));
    expect(stats.status).toBe(200);
    const a1 = stats.body.find((p: { id: string }) => p.id === A1);
    // project-stats completed_issues counts the completed AND cancelled groups (Django parity): 4 + 1.
    expect(a1).toMatchObject({ total_issues: 12, completed_issues: 5 });
  });

  // ---- advance analytics (member-scoped) ----

  it("advance overview is member-scoped: U0 sees only A1+A2 (20 items, 2 projects)", async () => {
    const res = await http.get(`${A}/advance-analytics/`).set("Cookie", cookie(0));
    expect(res.status).toBe(200);
    expect(res.body.total_work_items).toEqual({ count: 20 });
    expect(res.body.total_projects).toEqual({ count: 2 });
  });

  it("advance work-items tab classifies U0's scope (A1+A2)", async () => {
    const res = await http.get(`${A}/advance-analytics/?tab=work-items`).set("Cookie", cookie(0));
    expect(res.status).toBe(200);
    expect(res.body.total_work_items).toEqual({ count: 20 });
    expect(res.body.backlog_work_items).toEqual({ count: 8 }); // A1 3 + A2 5
    expect(res.body.completed_work_items).toEqual({ count: 7 }); // A1 4 + A2 3
    expect(res.body.started_work_items).toEqual({ count: 2 }); // A1 2
    expect(res.body.un_started_work_items).toEqual({ count: 2 }); // A1 2
  });

  it("advance stats: per-project rows for A1+A2 only (A3 excluded by scoping)", async () => {
    const res = await http.get(`${A}/advance-analytics-stats/`).set("Cookie", cookie(0));
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { project_id: string }) => r.project_id);
    expect(ids).toContain(A1);
    expect(ids).toContain(A2);
    expect(ids).not.toContain(A3);
    const a1 = res.body.find((r: { project_id: string }) => r.project_id === A1);
    expect(a1).toMatchObject({ completed_work_items: 4, backlog_work_items: 3, started_work_items: 2, un_started_work_items: 2, cancelled_work_items: 1 });
  });

  it("advance charts: projects/custom-work-items/work-items all sum to U0's 20", async () => {
    const proj = await http.get(`${A}/advance-analytics-charts/`).set("Cookie", cookie(0));
    expect(proj.status).toBe(200);
    expect(Object.fromEntries(proj.body.map((r: { key: string; count: number }) => [r.key, r.count])).work_items).toBe(20);

    const custom = await http.get(`${A}/advance-analytics-charts/?type=custom-work-items&x_axis=PRIORITY`).set("Cookie", cookie(0));
    expect(custom.status).toBe(200);
    expect(custom.body.data.reduce((s: number, d: { count: number }) => s + d.count, 0)).toBe(20);

    const wi = await http.get(`${A}/advance-analytics-charts/?type=work-items`).set("Cookie", cookie(0));
    expect(wi.status).toBe(200);
    expect(wi.body.data.reduce((s: number, d: { created_issues: number }) => s + d.created_issues, 0)).toBe(20);
  });

  it("advance scoping: U6 (A3 only) sees 6 items / 1 project", async () => {
    const res = await http.get(`${A}/advance-analytics/`).set("Cookie", cookie(6));
    expect(res.status).toBe(200);
    expect(res.body.total_work_items).toEqual({ count: 6 });
    expect(res.body.total_projects).toEqual({ count: 1 });
  });

  it("advance scoping: U8 (workspace member, no project) sees zeros", async () => {
    const res = await http.get(`${A}/advance-analytics/`).set("Cookie", cookie(8));
    expect(res.status).toBe(200);
    expect(res.body.total_work_items).toEqual({ count: 0 });
    expect(res.body.total_projects).toEqual({ count: 0 });
  });

  it("advance forbids a non-member of the workspace (U12 is Beta-only)", async () => {
    const res = await http.get(`${A}/advance-analytics/`).set("Cookie", cookie(12));
    expect(res.status).toBe(403);
  });

  // ---- project-scoped advance ----

  it("project advance-analytics for A1 (U0): counts + assignee stats", async () => {
    const base = `${A}/projects/${A1}`;
    const ov = await http.get(`${base}/advance-analytics/`).set("Cookie", cookie(0));
    expect(ov.status).toBe(200);
    expect(ov.body.total_work_items).toEqual({ count: 12 });
    expect(ov.body.completed_work_items).toEqual({ count: 4 });

    const stats = await http.get(`${base}/advance-analytics-stats/`).set("Cookie", cookie(0));
    expect(stats.status).toBe(200);
    const assigned = stats.body.find((r: { assignee_id: string | null }) => r.assignee_id === U[1]);
    expect(assigned).toMatchObject({ completed_work_items: 4, started_work_items: 2 });
  });

  it("project advance charts: custom-work-items (STATES) + cycle-scoped work-items series", async () => {
    const base = `${A}/projects/${A1}`;
    const byState = await http.get(`${base}/advance-analytics-charts/?type=custom-work-items&x_axis=STATES`).set("Cookie", cookie(0));
    expect(byState.status).toBe(200);
    expect(byState.body.data.reduce((s: number, d: { count: number }) => s + d.count, 0)).toBe(12);

    const cyc = await http.get(`${base}/advance-analytics-charts/?type=work-items&cycle_id=${acCycle}`).set("Cookie", cookie(0));
    expect(cyc.status).toBe(200);
    expect(cyc.body.data.reduce((s: number, d: { created_issues: number }) => s + d.created_issues, 0)).toBe(3); // 3 cycle issues in window
  });
});
