import { describe, expect, it, vi } from "vitest";
import { AUTHENTICATION_ERROR_CODES, AuthError } from "./error-codes";
import { redirectError } from "./auth-response";

const cfg = {
  get: (k: string, d?: string) =>
    (
      {
        APP_BASE_URL: "http://localhost:3000",
        WEB_URL: "http://localhost:3000",
      } as Record<string, string>
    )[k] ?? d,
} as any;

describe("redirectError", () => {
  it("302s to base/? with the error dict", () => {
    const res: any = { redirect: vi.fn() };
    const err = new AuthError({ code: AUTHENTICATION_ERROR_CODES.USER_DOES_NOT_EXIST, message: "USER_DOES_NOT_EXIST" });
    redirectError(cfg, res, {} as any, "app", err, "");
    expect(res.redirect).toHaveBeenCalledTimes(1);
    expect(String(res.redirect.mock.calls[0][0])).toContain("error_message=USER_DOES_NOT_EXIST");
  });
});
