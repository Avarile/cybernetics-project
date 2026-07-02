import { describe, it, expect, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { RbacGuard } from "./rbac.guard";
import type { MemberService } from "./member.service";
import { ROLE } from "./roles";
import type { RoleOptions } from "./roles.decorator";

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
  } as unknown as ExecutionContext;
}

function guardWith(meta: RoleOptions | undefined, members: Partial<MemberService>) {
  const reflector = { get: vi.fn().mockReturnValue(meta) } as unknown as Reflector;
  return new RbacGuard(reflector, members as MemberService);
}

const req = (over: Record<string, unknown> = {}) => ({
  user: { id: "u1" },
  params: { slug: "acme", project_id: "p1" },
  ...over,
});

describe("RbacGuard", () => {
  it("allows when no @Roles metadata", async () => {
    const guard = guardWith(undefined, {});
    await expect(guard.canActivate(ctx(req()))).resolves.toBe(true);
  });

  it("allows on matching project role", async () => {
    const guard = guardWith(
      { roles: [ROLE.ADMIN, ROLE.MEMBER], level: "PROJECT" },
      { hasProjectRole: vi.fn().mockResolvedValue(true) },
    );
    await expect(guard.canActivate(ctx(req()))).resolves.toBe(true);
  });

  it("applies workspace-admin-in-project override", async () => {
    const guard = guardWith(
      { roles: [ROLE.MEMBER], level: "PROJECT" },
      {
        hasProjectRole: vi.fn().mockResolvedValue(false),
        isProjectMember: vi.fn().mockResolvedValue(true),
        hasWorkspaceRole: vi.fn().mockResolvedValue(true), // admin at workspace
      },
    );
    await expect(guard.canActivate(ctx(req()))).resolves.toBe(true);
  });

  it("denies when neither role nor override matches", async () => {
    const guard = guardWith(
      { roles: [ROLE.ADMIN], level: "PROJECT" },
      {
        hasProjectRole: vi.fn().mockResolvedValue(false),
        isProjectMember: vi.fn().mockResolvedValue(false),
        hasWorkspaceRole: vi.fn().mockResolvedValue(false),
      },
    );
    await expect(guard.canActivate(ctx(req()))).rejects.toMatchObject({
      response: { error: "You don't have the required permissions." },
    });
  });

  it("honours workspace-level checks", async () => {
    const hasWorkspaceRole = vi.fn().mockResolvedValue(true);
    const guard = guardWith({ roles: [ROLE.ADMIN], level: "WORKSPACE" }, { hasWorkspaceRole });
    await expect(guard.canActivate(ctx(req()))).resolves.toBe(true);
    expect(hasWorkspaceRole).toHaveBeenCalledWith("acme", "u1", [ROLE.ADMIN]);
  });

  it("allows creator bypass when user created the object", async () => {
    const guard = guardWith(
      { roles: [ROLE.ADMIN], level: "PROJECT", creator: true, model: "issues" },
      {
        isWorkspaceMember: vi.fn().mockResolvedValue(true),
        isCreator: vi.fn().mockResolvedValue(true),
      },
    );
    await expect(guard.canActivate(ctx(req({ params: { slug: "acme", pk: "i1" } })))).resolves.toBe(true);
  });
});
