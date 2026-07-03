import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { ConfigService } from "../config/config.service";
import { CsrfService } from "./csrf.service";

function mockRes(): Response {
  return { cookie: vi.fn() } as unknown as Response;
}

function mockReq(cookieToken: string | undefined, opts: { body?: string; header?: string } = {}): Request {
  return {
    cookies: cookieToken === undefined ? {} : { csrftoken: cookieToken },
    body: opts.body === undefined ? {} : { csrfmiddlewaretoken: opts.body },
    headers: opts.header === undefined ? {} : { "x-csrftoken": opts.header },
  } as unknown as Request;
}

describe("CsrfService", () => {
  const config = new ConfigService();

  it("issue() sets a non-httpOnly csrftoken cookie and returns a 64-char hex token", () => {
    const svc = new CsrfService(config);
    const res = mockRes();
    const token = svc.issue(res);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.cookie).toHaveBeenCalledWith(
      "csrftoken",
      token,
      expect.objectContaining({ httpOnly: false, path: "/" }),
    );
  });

  it("validate() accepts a matching cookie + body token", () => {
    const svc = new CsrfService(config);
    const token = "a".repeat(64);
    expect(svc.validate(mockReq(token, { body: token }))).toBe(true);
  });

  it("validate() accepts a matching cookie + header token", () => {
    const svc = new CsrfService(config);
    const token = "b".repeat(64);
    expect(svc.validate(mockReq(token, { header: token }))).toBe(true);
  });

  it("validate() rejects when the cookie is missing", () => {
    const svc = new CsrfService(config);
    expect(svc.validate(mockReq(undefined, { body: "c".repeat(64) }))).toBe(false);
  });

  it("validate() rejects when nothing is submitted", () => {
    const svc = new CsrfService(config);
    expect(svc.validate(mockReq("d".repeat(64)))).toBe(false);
  });

  it("validate() rejects a mismatched token without throwing (length differs)", () => {
    const svc = new CsrfService(config);
    expect(svc.validate(mockReq("e".repeat(64), { body: "short" }))).toBe(false);
  });

  it("validate() rejects a same-length mismatched token", () => {
    const svc = new CsrfService(config);
    expect(svc.validate(mockReq("f".repeat(64), { body: "g".repeat(64) }))).toBe(false);
  });
});
