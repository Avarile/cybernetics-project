/**
 * Celery task-protocol v2 message construction — byte-compatible with what Django's Celery workers
 * produce/consume, so a Django worker can run a NestJS-enqueued task and vice-versa.
 *
 * Protocol v2 (JSON content-type):
 *   - task name lives in the AMQP header `task` (NOT the body)
 *   - body is a JSON 3-tuple: [args, kwargs, embed]
 *   - published to the default exchange "" with routing key = queue name
 *   - body is raw JSON bytes (base64 only applies to pickle/binary content-types)
 */
import { randomUUID } from "crypto";
import { hostname } from "os";

export type CeleryKwargs = Record<string, unknown>;

export interface CeleryMessageOptions {
  args?: unknown[];
  /** Task id + correlation id. Injectable for deterministic tests; random uuid4 otherwise. */
  id?: string;
  /** origin header, e.g. "gen1@host". Injectable for tests. */
  origin?: string;
  etaIso?: string | null;
  expiresIso?: string | null;
  retries?: number;
}

export interface CeleryPublish {
  /** JSON body bytes: [args, kwargs, embed] */
  body: Buffer;
  properties: {
    contentType: "application/json";
    contentEncoding: "utf-8";
    correlationId: string;
    deliveryMode: 2;
    priority: 0;
    headers: Record<string, unknown>;
  };
}

/** Python-style repr for the cosmetic `argsrepr`/`kwargsrepr` headers (workers ignore these). */
export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  if (Array.isArray(value)) return "[" + value.map(pyRepr).join(", ") + "]";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`,
    );
    return "{" + entries.join(", ") + "}";
  }
  return String(value);
}

/**
 * Build the AMQP message for `<task>.apply_async(args, kwargs)` in Celery protocol v2.
 * The embed tuple (callbacks/errbacks/chain/chord) is always the "no-chain" form Plane uses.
 */
export function buildCeleryMessage(
  taskName: string,
  kwargs: CeleryKwargs,
  opts: CeleryMessageOptions = {},
): CeleryPublish {
  const id = opts.id ?? randomUUID();
  const args = opts.args ?? [];
  const embed = { callbacks: null, errbacks: null, chain: null, chord: null };
  const body = Buffer.from(JSON.stringify([args, kwargs, embed]), "utf-8");

  return {
    body,
    properties: {
      contentType: "application/json",
      contentEncoding: "utf-8",
      correlationId: id,
      deliveryMode: 2,
      priority: 0,
      headers: {
        lang: "py",
        task: taskName,
        id,
        root_id: id,
        parent_id: null,
        group: null,
        retries: opts.retries ?? 0,
        eta: opts.etaIso ?? null,
        expires: opts.expiresIso ?? null,
        timelimit: [null, null],
        argsrepr: pyRepr(args).replace(/^\[/, "(").replace(/\]$/, args.length === 1 ? ",)" : ")"),
        kwargsrepr: pyRepr(kwargs),
        origin: opts.origin ?? `gen1@${hostname()}`,
        ignore_result: true,
      },
    },
  };
}

/** Parse an incoming Celery message body -> [args, kwargs]. */
export function parseCeleryBody(body: Buffer): { args: unknown[]; kwargs: CeleryKwargs } {
  const parsed = JSON.parse(body.toString("utf-8"));
  if (!Array.isArray(parsed) || parsed.length < 2) throw new Error("Invalid Celery v2 body");
  return { args: parsed[0] ?? [], kwargs: parsed[1] ?? {} };
}
