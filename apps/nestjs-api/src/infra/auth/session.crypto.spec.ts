import { describe, it, expect } from "vitest";
import {
  djangoDumps,
  djangoLoads,
  sessionAuthHash,
  newSessionKey,
  buildSessionPayload,
  __test,
} from "./session.crypto";

const SECRET = "django-insecure-test-secret-key-000";

describe("django signing round-trip", () => {
  it("dumps then loads back the same object", () => {
    const payload = { _auth_user_id: "550e8400-e29b-41d4-a716-446655440000", n: 42, nested: { a: [1, 2, 3] } };
    const signed = djangoDumps(payload, SECRET, 499162800);
    expect(djangoLoads(signed, SECRET)).toEqual(payload);
  });

  it("produces the payload:timestamp:signature shape", () => {
    const signed = djangoDumps({ a: 1 }, SECRET, 1000);
    const parts = signed.split(":");
    expect(parts.length).toBe(3);
    expect(parts[1]).toBe(__test.base62(1000));
  });

  it("rejects a tampered signature", () => {
    const signed = djangoDumps({ a: 1 }, SECRET, 1000);
    const tampered = signed.slice(0, -2) + (signed.slice(-2) === "AA" ? "BB" : "AA");
    expect(() => djangoLoads(tampered, SECRET)).toThrow(/BadSignature/);
  });

  it("rejects a wrong secret", () => {
    const signed = djangoDumps({ a: 1 }, SECRET, 1000);
    expect(() => djangoLoads(signed, "other-secret")).toThrow(/BadSignature/);
  });

  it("compresses large payloads (leading '.') and still round-trips", () => {
    const big = { blob: "x".repeat(2000) };
    const signed = djangoDumps(big, SECRET, 1000);
    expect(signed.startsWith(".")).toBe(true); // compression prefix
    expect(djangoLoads(signed, SECRET)).toEqual(big);
  });
});

describe("base62", () => {
  it("encodes/decodes symmetrically", () => {
    for (const n of [0, 1, 61, 62, 1000, 499162800, 1719900000]) {
      expect(__test.base62Decode(__test.base62(n))).toBe(n);
    }
  });
});

describe("sessionAuthHash", () => {
  it("is deterministic and depends on password + secret", () => {
    expect(sessionAuthHash("pw", SECRET)).toBe(sessionAuthHash("pw", SECRET));
    expect(sessionAuthHash("pw", SECRET)).not.toBe(sessionAuthHash("pw2", SECRET));
    expect(sessionAuthHash("pw", SECRET)).not.toBe(sessionAuthHash("pw", "s2"));
    expect(sessionAuthHash("pw", SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("newSessionKey", () => {
  it("is 128 chars of [a-z0-9] and unique", () => {
    const k = newSessionKey();
    expect(k).toHaveLength(128);
    expect(k).toMatch(/^[a-z0-9]{128}$/);
    expect(newSessionKey()).not.toBe(newSessionKey());
  });
});

describe("buildSessionPayload", () => {
  it("mirrors Django login() session dict", () => {
    const p = buildSessionPayload("uid-1", "hashedpw", SECRET, { ip_address: "1.2.3.4" });
    expect(p._auth_user_id).toBe("uid-1");
    expect(p._auth_user_backend).toBe("django.contrib.auth.backends.ModelBackend");
    expect(p._auth_user_hash).toBe(sessionAuthHash("hashedpw", SECRET));
    expect(p.device_info).toEqual({ ip_address: "1.2.3.4" });
  });
});
