import { describe, expect, it } from "vitest";
import { AUTHENTICATION_ERROR_CODES, AuthError } from "./error-codes";

describe("AuthError", () => {
  it("builds the error dict with payload merged", () => {
    const e = new AuthError({
      code: AUTHENTICATION_ERROR_CODES.INVALID_EMAIL,
      message: "INVALID_EMAIL",
      payload: { email: "x@y.z" },
    });
    expect(e.getErrorDict()).toEqual({
      error_code: String(AUTHENTICATION_ERROR_CODES.INVALID_EMAIL),
      error_message: "INVALID_EMAIL",
      email: "x@y.z",
    });
  });

  it("known codes exist", () => {
    for (const k of [
      "INSTANCE_NOT_CONFIGURED",
      "EMAIL_REQUIRED",
      "INVALID_EMAIL",
      "USER_DOES_NOT_EXIST",
      "AUTHENTICATION_FAILED",
      "RATE_LIMIT_EXCEEDED",
    ])
      expect(typeof AUTHENTICATION_ERROR_CODES[k]).toBe("number");
  });

  it("defaults status to 400", () => {
    const e = new AuthError({ code: AUTHENTICATION_ERROR_CODES.EMAIL_REQUIRED, message: "EMAIL_REQUIRED" });
    expect(e.status).toBe(400);
  });

  it("maps RATE_LIMIT_EXCEEDED to status 429", () => {
    const e = new AuthError({ code: AUTHENTICATION_ERROR_CODES.RATE_LIMIT_EXCEEDED, message: "RATE_LIMIT_EXCEEDED" });
    expect(e.status).toBe(429);
  });
});
