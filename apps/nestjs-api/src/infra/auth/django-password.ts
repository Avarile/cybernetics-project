/**
 * Django password hashing parity (PBKDF2), so email/password sign-in can verify existing
 * user.password hashes created by Django and (optionally) write compatible hashes.
 *
 * Django default format:  pbkdf2_sha256$<iterations>$<salt>$<base64(hash)>
 *   hash = pbkdf2_hmac(digest, password, salt, iterations)  (dklen defaults to the digest size)
 */
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const DIGEST_BY_ALGO: Record<string, { digest: string; keylen: number }> = {
  pbkdf2_sha256: { digest: "sha256", keylen: 32 },
  pbkdf2_sha1: { digest: "sha1", keylen: 20 },
};

const DEFAULT_ITERATIONS = 600000; // Django 4.2 default for PBKDF2PasswordHasher
const SALT_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomSalt(length = 22): string {
  const buf = randomBytes(length);
  let s = "";
  for (let i = 0; i < length; i++) s += SALT_ALPHABET[buf[i] % SALT_ALPHABET.length];
  return s;
}

/** Constant-time verify of a raw password against a Django-encoded hash. */
export function verifyDjangoPassword(password: string, encoded: string): boolean {
  if (!password || !encoded) return false;
  const parts = encoded.split("$");
  if (parts.length !== 4) return false;
  const [algorithm, iterationsStr, salt, expectedB64] = parts;
  const spec = DIGEST_BY_ALGO[algorithm];
  if (!spec) return false; // unsupported hasher (bcrypt/argon2 would need extra deps)
  const iterations = Number(iterationsStr);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const derived = pbkdf2Sync(Buffer.from(password, "utf-8"), Buffer.from(salt, "utf-8"), iterations, spec.keylen, spec.digest);
  const expected = Buffer.from(expectedB64, "base64");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Produce a Django-compatible pbkdf2_sha256 hash (for password set/reset flows). */
export function makeDjangoPassword(
  password: string,
  opts: { iterations?: number; salt?: string } = {},
): string {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const salt = opts.salt ?? randomSalt();
  const derived = pbkdf2Sync(Buffer.from(password, "utf-8"), Buffer.from(salt, "utf-8"), iterations, 32, "sha256");
  return `pbkdf2_sha256$${iterations}$${salt}$${derived.toString("base64")}`;
}
