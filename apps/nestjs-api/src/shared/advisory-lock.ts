import { createHash } from "node:crypto";

/**
 * Port of Django's convert_uuid_to_integer used for pg_advisory_xact_lock:
 * sha256(uuid) -> first 8 bytes -> signed 64-bit big-endian. Ensures per-project serial issue
 * sequence assignment under concurrency (Issue.save advisory lock).
 */
export function uuidToLockKey(uuid: string): bigint {
  return createHash("sha256").update(uuid).digest().readBigInt64BE(0);
}
