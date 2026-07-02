/**
 * Minimal 5-field cron ("m h dom mon dow") next-occurrence calculator in UTC — dependency-free,
 * covering the patterns used by the Celery beat schedule. Vixie-cron day semantics: when BOTH dom
 * and dow are restricted, a day matches if EITHER matches.
 */
interface FieldRange {
  min: number;
  max: number;
}

function parseField(spec: string, { min, max }: FieldRange): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    let step = 1;
    let range = part;
    const slash = part.split("/");
    if (slash.length === 2) {
      range = slash[0];
      step = parseInt(slash[1], 10);
    }
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = parseInt(a, 10);
      hi = parseInt(b, 10);
    } else {
      lo = hi = parseInt(range, 10);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function cronNext(expr: string, from: Date): Date {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: "${expr}"`);
  const [m, h, dom, mon, dow] = parts;

  const mins = parseField(m, { min: 0, max: 59 });
  const hrs = parseField(h, { min: 0, max: 23 });
  const doms = parseField(dom, { min: 1, max: 31 });
  const mons = parseField(mon, { min: 1, max: 12 });
  const dows = new Set([...parseField(dow, { min: 0, max: 7 })].map((d) => (d === 7 ? 0 : d)));
  const domRestricted = dom !== "*";
  const dowRestricted = dow !== "*";

  const t = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), from.getUTCHours(), from.getUTCMinutes()),
  );
  t.setUTCMinutes(t.getUTCMinutes() + 1); // strictly after `from`
  const limit = new Date(t);
  limit.setUTCFullYear(limit.getUTCFullYear() + 4);

  while (t <= limit) {
    if (mons.has(t.getUTCMonth() + 1) && hrs.has(t.getUTCHours()) && mins.has(t.getUTCMinutes())) {
      const domMatch = doms.has(t.getUTCDate());
      const dowMatch = dows.has(t.getUTCDay());
      const dayOk =
        domRestricted && dowRestricted
          ? domMatch || dowMatch
          : domRestricted
            ? domMatch
            : dowRestricted
              ? dowMatch
              : true;
      if (dayOk) return new Date(t);
    }
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  throw new Error(`No next occurrence within 4 years for cron "${expr}"`);
}
