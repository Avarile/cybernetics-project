import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import * as schema from "../src/infra/database/schema";
import { profiles, users, workspaceMembers, workspaces } from "../src/infra/database/schema";
import { workspaceMemberInvites } from "../src/modules/workspace/workspace-member-invite.schema";
import { getRedirectionPath } from "../src/infra/auth/redirection-path";

// Faithful port of apps/api/plane/authentication/utils/redirection_path.py:8-46. Seeds its own rows
// (random ids/emails) against plane_test and cleans them up -- the table may already hold rows from
// other suites.
describe("getRedirectionPath", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const inviteIds: string[] = [];

  function makeUser(email: string) {
    const id = randomUUID();
    userIds.push(id);
    return { id, email };
  }

  async function insertUser(id: string, email: string) {
    const now = new Date();
    await db.insert(users).values({ id, email, isActive: true, createdAt: now, updatedAt: now });
  }

  async function insertProfile(userId: string, opts: { isOnboarded: boolean; lastWorkspaceId?: string | null }) {
    await db.insert(profiles).values({ userId, isOnboarded: opts.isOnboarded, lastWorkspaceId: opts.lastWorkspaceId ?? null });
  }

  async function insertWorkspace(slug: string, ownerId: string, createdAt: Date) {
    const id = randomUUID();
    workspaceIds.push(id);
    await db.insert(workspaces).values({ id, name: slug, slug, ownerId, createdAt });
    return id;
  }

  async function insertMembership(workspaceId: string, memberId: string, isActive = true) {
    await db.insert(workspaceMembers).values({ workspaceId, memberId, isActive });
  }

  async function insertInvite(workspaceId: string, email: string, accepted: boolean) {
    const id = randomUUID();
    inviteIds.push(id);
    await db.insert(workspaceMemberInvites).values({ id, workspaceId, email, accepted, token: randomUUID() });
  }

  afterAll(async () => {
    if (inviteIds.length) await db.delete(workspaceMemberInvites).where(inArray(workspaceMemberInvites.id, inviteIds));
    if (workspaceIds.length) await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, workspaceIds));
    if (userIds.length) await db.delete(profiles).where(inArray(profiles.userId, userIds));
    if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  });

  it("routes a member with no last_workspace_id to their workspace slug", async () => {
    const user = makeUser(`rp-${randomUUID()}@test.dev`);
    await insertUser(user.id, user.email);
    await insertProfile(user.id, { isOnboarded: true });
    const wsId = await insertWorkspace(`rp-solo-${randomUUID().slice(0, 8)}`, user.id, new Date());
    await insertMembership(wsId, user.id);

    const [ws] = await db.select({ slug: workspaces.slug }).from(workspaces).where(inArray(workspaces.id, [wsId]));
    await expect(getRedirectionPath(db as never, user)).resolves.toBe(ws.slug);
  });

  it("prefers profile.last_workspace_id over an earlier-created membership", async () => {
    const user = makeUser(`rp-${randomUUID()}@test.dev`);
    await insertUser(user.id, user.email);
    const earlier = await insertWorkspace(`rp-early-${randomUUID().slice(0, 8)}`, user.id, new Date(Date.now() - 60_000));
    const last = await insertWorkspace(`rp-last-${randomUUID().slice(0, 8)}`, user.id, new Date());
    await insertMembership(earlier, user.id);
    await insertMembership(last, user.id);
    await insertProfile(user.id, { isOnboarded: true, lastWorkspaceId: last });

    const [ws] = await db.select({ slug: workspaces.slug }).from(workspaces).where(inArray(workspaces.id, [last]));
    await expect(getRedirectionPath(db as never, user)).resolves.toBe(ws.slug);
  });

  it("falls back to the earliest-created active membership when last_workspace_id isn't a valid membership", async () => {
    const user = makeUser(`rp-${randomUUID()}@test.dev`);
    await insertUser(user.id, user.email);
    const stale = await insertWorkspace(`rp-stale-${randomUUID().slice(0, 8)}`, user.id, new Date());
    const earliest = await insertWorkspace(`rp-earliest-${randomUUID().slice(0, 8)}`, user.id, new Date(Date.now() - 120_000));
    const later = await insertWorkspace(`rp-later-${randomUUID().slice(0, 8)}`, user.id, new Date(Date.now() - 60_000));
    // Not a member of `stale` at all -- last_workspace_id points at a workspace they can't access.
    await insertMembership(earliest, user.id);
    await insertMembership(later, user.id);
    await insertProfile(user.id, { isOnboarded: true, lastWorkspaceId: stale });

    const [ws] = await db.select({ slug: workspaces.slug }).from(workspaces).where(inArray(workspaces.id, [earliest]));
    await expect(getRedirectionPath(db as never, user)).resolves.toBe(ws.slug);
  });

  it("routes a fresh user with no profile row to onboarding", async () => {
    const user = makeUser(`rp-${randomUUID()}@test.dev`);
    await insertUser(user.id, user.email);
    // no profile row inserted

    await expect(getRedirectionPath(db as never, user)).resolves.toBe("onboarding");
  });

  it("routes to onboarding when not onboarded, even with an active workspace membership", async () => {
    const user = makeUser(`rp-${randomUUID()}@test.dev`);
    await insertUser(user.id, user.email);
    const wsId = await insertWorkspace(`rp-notonboarded-${randomUUID().slice(0, 8)}`, user.id, new Date());
    await insertMembership(wsId, user.id);
    await insertProfile(user.id, { isOnboarded: false });

    await expect(getRedirectionPath(db as never, user)).resolves.toBe("onboarding");
  });

  it("routes an onboarded user with no workspace but a pending invite to invitations", async () => {
    const user = makeUser(`rp-${randomUUID()}@test.dev`);
    await insertUser(user.id, user.email);
    await insertProfile(user.id, { isOnboarded: true });
    const otherWs = await insertWorkspace(`rp-inviter-${randomUUID().slice(0, 8)}`, user.id, new Date());
    await insertInvite(otherWs, user.email, false);

    await expect(getRedirectionPath(db as never, user)).resolves.toBe("invitations");
  });

  it("counts an already-accepted invite too (Django's queryset has no accepted filter)", async () => {
    const user = makeUser(`rp-${randomUUID()}@test.dev`);
    await insertUser(user.id, user.email);
    await insertProfile(user.id, { isOnboarded: true });
    const otherWs = await insertWorkspace(`rp-accepted-${randomUUID().slice(0, 8)}`, user.id, new Date());
    await insertInvite(otherWs, user.email, true);

    await expect(getRedirectionPath(db as never, user)).resolves.toBe("invitations");
  });

  it("routes an onboarded user with no workspace and no invite to create-workspace", async () => {
    const user = makeUser(`rp-${randomUUID()}@test.dev`);
    await insertUser(user.id, user.email);
    await insertProfile(user.id, { isOnboarded: true });

    await expect(getRedirectionPath(db as never, user)).resolves.toBe("create-workspace");
  });
});
