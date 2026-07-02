/**
 * Django-compatible session signing (Django 4.2), for drop-in `session-id` cookie compatibility.
 *
 * The custom DB session engine (plane/db/models/session.py) stores the RAW unsigned session_key as
 * the cookie value, so READING sessions needs no crypto (resolve cookie -> sessions row -> user_id).
 * Only the `session_data` column is signed via django.core.signing.dumps(...). We replicate that so
 * Django can still decode NestJS-created sessions (bidirectional compat) using the shared SECRET_KEY.
 */
import { createHash, createHmac, randomBytes } from "crypto";
import { deflateSync, inflateSync } from "zlib";

const SESSION_SALT = "django.contrib.sessions.SessionBase";
const AUTH_HASH_SALT = "django.contrib.auth.models.AbstractBaseUser.get_session_auth_hash";
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789"; // VALID_KEY_CHARS in session.py

const b64u = (b: Buffer): string => b.toString("base64url");

/** Django Signer key derivation: sha256(key_salt + "signer" + secret). */
function signerKey(secret: string): Buffer {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(SESSION_SALT + "signer"), Buffer.from(secret)]))
    .digest();
}

function base62(n: number): string {
  if (n === 0) return "0";
  let s = "";
  while (n > 0) {
    s = B62[n % 62] + s;
    n = Math.floor(n / 62);
  }
  return s;
}

function base62Decode(s: string): number {
  let n = 0;
  for (const ch of s) n = n * 62 + B62.indexOf(ch);
  return n;
}

/**
 * Equivalent of django.core.signing.dumps(obj, salt="django.contrib.sessions.SessionBase",
 * serializer=JSONSerializer, compress=True). `nowSec` is injectable for deterministic tests.
 */
export function djangoDumps(obj: unknown, secret: string, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const json = Buffer.from(JSON.stringify(obj), "utf-8");
  const compressed = deflateSync(json);
  // Django prefixes "." when compression actually shrinks the payload (is_compressed logic).
  const useCompression = compressed.length < json.length - 1;
  const payload = useCompression ? "." + b64u(compressed) : b64u(json);
  const value = `${payload}:${base62(nowSec)}`;
  const sig = b64u(createHmac("sha256", signerKey(secret)).update(value).digest());
  return `${value}:${sig}`;
}

/** Equivalent of django.core.signing.loads(...). Verifies signature; returns the parsed object. */
export function djangoLoads(signed: string, secret: string): unknown {
  const lastColon = signed.lastIndexOf(":");
  if (lastColon < 0) throw new Error("BadSignature: no signature");
  const value = signed.slice(0, lastColon);
  const providedSig = signed.slice(lastColon + 1);
  const expectedSig = b64u(createHmac("sha256", signerKey(secret)).update(value).digest());
  if (providedSig !== expectedSig) throw new Error("BadSignature");

  const tsColon = value.lastIndexOf(":");
  let payload = value.slice(0, tsColon);
  const compressed = payload.startsWith(".");
  if (compressed) payload = payload.slice(1);
  const raw = Buffer.from(payload, "base64url");
  const json = compressed ? inflateSync(raw) : raw;
  return JSON.parse(json.toString("utf-8"));
}

/** django.contrib.auth `user.get_session_auth_hash()` — salted HMAC over the password hash. */
export function sessionAuthHash(password: string, secret: string): string {
  const key = createHash("sha256")
    .update(Buffer.concat([Buffer.from(AUTH_HASH_SALT), Buffer.from(secret)]))
    .digest();
  return createHmac("sha256", key).update(password).digest("hex");
}

/** Matches SessionStore._get_new_session_key: 128 chars of [a-z0-9]. */
export function newSessionKey(): string {
  const buf = randomBytes(128);
  let s = "";
  for (let i = 0; i < 128; i++) s += KEY_CHARS[buf[i] % KEY_CHARS.length];
  return s;
}

/** Build the session_data payload Django's login() writes. */
export interface SessionPayload {
  _auth_user_id: string;
  _auth_user_backend: string;
  _auth_user_hash: string;
  device_info?: Record<string, unknown> | null;
}

export function buildSessionPayload(
  userId: string,
  password: string,
  secret: string,
  deviceInfo: Record<string, unknown> | null,
): SessionPayload {
  return {
    _auth_user_id: String(userId),
    _auth_user_backend: "django.contrib.auth.backends.ModelBackend",
    _auth_user_hash: sessionAuthHash(password, secret),
    device_info: deviceInfo,
  };
}

export const __test = { base62, base62Decode };
