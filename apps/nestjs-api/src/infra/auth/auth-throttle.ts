const UNIT_MS: Record<string, number> = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 };
/** Mirror plane/authentication/rate_limit.py "<count>/<unit>" (default 10/minute). */
export function parseRateLimit(raw: string | undefined): { limit: number; ttl: number } {
  const m = /^(\d+)\/(second|minute|hour|day)$/.exec((raw ?? "").trim());
  if (!m) return { limit: 10, ttl: 60000 };
  return { limit: Number(m[1]), ttl: UNIT_MS[m[2]] };
}
