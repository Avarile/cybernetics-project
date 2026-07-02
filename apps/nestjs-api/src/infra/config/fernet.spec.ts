import { describe, it, expect } from "vitest";
import { deriveFernetKey, fernetEncrypt, fernetDecrypt } from "./fernet";

// Canonical Fernet spec test vector (github.com/fernet/spec generate.json):
//   secret: cw_0x689RpI-jtRR7oE8h_eQsKImvJapLeSbXpwF4e4=
//   now:    1985-10-26T01:20:00-07:00  -> unix 499162800
//   iv:     [0..15]
//   src:    "hello"
const VECTOR = {
  secret: "cw_0x689RpI-jtRR7oE8h_eQsKImvJapLeSbXpwF4e4=",
  token:
    "gAAAAAAdwJ6wAAECAwQFBgcICQoLDA0ODy021cpGVWKZ_eEwCGM4BLLF_5CV9dOPmrhuVUPgJobwOz7JcbmrR64jVmpU4IwqDA==",
  iv: Buffer.from(Array.from({ length: 16 }, (_, i) => i)),
  timestampSec: 499162800,
  src: "hello",
};

describe("Fernet — Python cryptography parity", () => {
  it("decrypts the canonical spec token", () => {
    expect(fernetDecrypt(VECTOR.secret, VECTOR.token)).toBe(VECTOR.src);
  });

  it("encrypts to the canonical spec token (deterministic iv + timestamp)", () => {
    const token = fernetEncrypt(VECTOR.secret, VECTOR.src, {
      iv: VECTOR.iv,
      timestampSec: VECTOR.timestampSec,
    });
    expect(token).toBe(VECTOR.token);
  });

  it("rejects a tampered token (HMAC failure)", () => {
    const bad = VECTOR.token.slice(0, -4) + "AAAA";
    expect(() => fernetDecrypt(VECTOR.secret, bad)).toThrow();
  });
});

describe("deriveFernetKey — Django PBKDF2 params", () => {
  it("produces a 32-byte urlsafe-b64 Fernet key (44 chars, padded)", () => {
    const key = deriveFernetKey("some-django-secret-key");
    expect(key).toHaveLength(44);
    expect(key.endsWith("=")).toBe(true);
    expect(key).toMatch(/^[A-Za-z0-9_-]+=*$/);
  });

  it("is deterministic for the same secret and differs across secrets", () => {
    expect(deriveFernetKey("a")).toBe(deriveFernetKey("a"));
    expect(deriveFernetKey("a")).not.toBe(deriveFernetKey("b"));
  });

  it("round-trips encrypt/decrypt with a derived key", () => {
    const key = deriveFernetKey("django-secret");
    const secret = "sk-live-abc123::the LLM api key value";
    expect(fernetDecrypt(key, fernetEncrypt(key, secret))).toBe(secret);
  });
});
