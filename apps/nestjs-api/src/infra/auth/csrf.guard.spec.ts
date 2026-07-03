import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { CsrfGuard } from "./csrf.guard";
import type { CsrfService } from "./csrf.service";

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe("CsrfGuard", () => {
  it("allows the request through when validate() passes", () => {
    const csrf = { validate: vi.fn().mockReturnValue(true) };
    const guard = new CsrfGuard(csrf as unknown as CsrfService);
    expect(guard.canActivate(ctx({}))).toBe(true);
  });

  it("throws ForbiddenException when validate() fails", () => {
    const csrf = { validate: vi.fn().mockReturnValue(false) };
    const guard = new CsrfGuard(csrf as unknown as CsrfService);
    expect(() => guard.canActivate(ctx({}))).toThrowError(
      expect.objectContaining({ response: expect.objectContaining({ detail: expect.stringMatching(/CSRF/) }) }),
    );
  });
});
