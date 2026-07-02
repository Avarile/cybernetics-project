import { describe, it, expect, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { SessionGuard } from "./session.guard";
import type { SessionService } from "./session.service";

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe("SessionGuard", () => {
  it("throws 401 {detail} when no cookie present", async () => {
    const guard = new SessionGuard({ resolve: vi.fn() } as unknown as SessionService);
    await expect(guard.canActivate(ctx({ path: "/api/users/me", cookies: {} }))).rejects.toMatchObject({
      response: { detail: "Authentication credentials were not provided." },
    });
  });

  it("resolves session-id cookie and sets req.user", async () => {
    const user = { id: "u1" };
    const sessions = { resolve: vi.fn().mockResolvedValue({ user, session: { sessionKey: "k" } }) };
    const guard = new SessionGuard(sessions as unknown as SessionService);
    const req: Record<string, unknown> = { path: "/api/users/me", cookies: { "session-id": "abc" } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(sessions.resolve).toHaveBeenCalledWith("abc");
    expect(req.user).toBe(user);
  });

  it("selects admin-session-id cookie on /instances paths", async () => {
    const sessions = { resolve: vi.fn().mockResolvedValue({ user: { id: "a" }, session: {} }) };
    const guard = new SessionGuard(sessions as unknown as SessionService);
    await guard.canActivate(ctx({ path: "/api/instances/admins/me", cookies: { "admin-session-id": "adm" } }));
    expect(sessions.resolve).toHaveBeenCalledWith("adm");
  });

  it("throws when session cannot be resolved", async () => {
    const sessions = { resolve: vi.fn().mockResolvedValue(null) };
    const guard = new SessionGuard(sessions as unknown as SessionService);
    await expect(
      guard.canActivate(ctx({ path: "/api/users/me", cookies: { "session-id": "bad" } })),
    ).rejects.toMatchObject({ response: { detail: "Invalid session" } });
  });
});
