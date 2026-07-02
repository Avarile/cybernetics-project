/**
 * Fernet symmetric encryption — byte-compatible with Python `cryptography.fernet.Fernet`,
 * which backs Django's encrypted `InstanceConfiguration` values (plane/license/utils/encryption.py).
 *
 * Token layout (all base64url with padding):
 *   version(0x80) | timestamp(8B BE) | IV(16B) | ciphertext(AES-128-CBC/PKCS7) | HMAC-SHA256(32B)
 * The 32-byte Fernet key splits into signing_key = key[0:16], encryption_key = key[16:32].
 */
import { createCipheriv, createDecipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const VERSION = 0x80;

/** base64 (standard) -> urlsafe, padding preserved (matches Python urlsafe_b64encode). */
function urlsafeB64Encode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

/** urlsafe base64 (padded or not) -> Buffer. */
function urlsafeB64Decode(str: string): Buffer {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Django key derivation (plane/license/utils/encryption.py):
 *   PBKDF2HMAC(sha256, length=32, salt=b"salt", iterations=100000) over SECRET_KEY,
 *   then urlsafe_b64encode -> the Fernet key string.
 */
export function deriveFernetKey(secretKey: string): string {
  const dk = pbkdf2Sync(Buffer.from(secretKey, "utf-8"), Buffer.from("salt", "utf-8"), 100000, 32, "sha256");
  return urlsafeB64Encode(dk);
}

function splitKey(fernetKey: string): { signingKey: Buffer; encryptionKey: Buffer } {
  const key = urlsafeB64Decode(fernetKey);
  if (key.length !== 32) throw new Error(`Invalid Fernet key length: ${key.length} (expected 32)`);
  return { signingKey: key.subarray(0, 16), encryptionKey: key.subarray(16, 32) };
}

export interface FernetEncryptOptions {
  /** 16-byte IV; random if omitted (only set for deterministic tests). */
  iv?: Buffer;
  /** Unix seconds; now if omitted (only set for deterministic tests). */
  timestampSec?: number;
}

export function fernetEncrypt(fernetKey: string, plaintext: string, opts: FernetEncryptOptions = {}): string {
  const { signingKey, encryptionKey } = splitKey(fernetKey);
  const iv = opts.iv ?? randomBytes(16);
  if (iv.length !== 16) throw new Error("IV must be 16 bytes");
  const ts = opts.timestampSec ?? Math.floor(Date.now() / 1000);

  const version = Buffer.from([VERSION]);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(ts));

  const cipher = createCipheriv("aes-128-cbc", encryptionKey, iv); // PKCS7 padding on by default
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf-8")), cipher.final()]);

  const basic = Buffer.concat([version, timestamp, iv, ciphertext]);
  const hmac = createHmac("sha256", signingKey).update(basic).digest();
  return urlsafeB64Encode(Buffer.concat([basic, hmac]));
}

export function fernetDecrypt(fernetKey: string, token: string): string {
  const { signingKey, encryptionKey } = splitKey(fernetKey);
  const data = urlsafeB64Decode(token);
  if (data.length < 1 + 8 + 16 + 32) throw new Error("Invalid Fernet token (too short)");
  if (data[0] !== VERSION) throw new Error("Invalid Fernet version");

  const basic = data.subarray(0, data.length - 32);
  const providedHmac = data.subarray(data.length - 32);
  const expectedHmac = createHmac("sha256", signingKey).update(basic).digest();
  if (providedHmac.length !== expectedHmac.length || !timingSafeEqual(providedHmac, expectedHmac)) {
    throw new Error("Fernet signature verification failed");
  }

  const iv = data.subarray(9, 25);
  const ciphertext = data.subarray(25, data.length - 32);
  const decipher = createDecipheriv("aes-128-cbc", encryptionKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}
