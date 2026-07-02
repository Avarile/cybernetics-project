import type { ActivityRepository } from "./activity.repository";
import type { NewIssueActivity } from "./activity.schema";

/**
 * Shared types + helpers for the issue_activity mappers (ported from
 * plane/bgtasks/issue_activities_task.py). Kept dependency-free so trackers and entity-mappers can
 * both import from here without an import cycle.
 */

export type Dict = Record<string, unknown>;

export interface BaseFields {
  projectId: string;
  workspaceId: string;
  issueId: string | null;
  actorId: string | null;
  epoch: number | null;
}

export interface ActivityCtx {
  repo: ActivityRepository;
  base: BaseFields;
  rows: NewIssueActivity[];
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** is_valid_uuid(): Django requires a v4 UUID. */
export const isValidUuid = (v: unknown): v is string => typeof v === "string" && UUID_V4.test(v);

/** uuid column guard — coerce a raw value to a v4 uuid string or null (never a bad insert). */
export const uuidOrNull = (v: unknown): string | null => (isValidUuid(v) ? v : null);

/** stringify-or-null, mirroring `x if x is not None`. */
export const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** current_instance.get(key) semantics: absent -> null. */
export const pick = (o: Dict | null, k: string): unknown => (o && k in o ? o[k] : null);

/** parse the raw JSON string Django hands the task; already-parsed / null pass through. */
export const parseJson = (v: unknown): Dict | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Dict;
    } catch {
      return null;
    }
  }
  return v as Dict;
};

/** extract_ids(data, primary_key, fallback_key). */
export const extractIds = (data: Dict | null, primary: string, fallback: string): Set<string> => {
  if (!data) return new Set();
  const src = primary in data ? data[primary] : data[fallback];
  return new Set(Array.isArray(src) ? src.map((x) => String(x)) : []);
};

/** Append a row, filling the common tenancy/actor/epoch fields from ctx.base. */
export const push = (ctx: ActivityCtx, over: Partial<NewIssueActivity> & { verb: string }): void => {
  ctx.rows.push({
    projectId: ctx.base.projectId,
    workspaceId: ctx.base.workspaceId,
    issueId: ctx.base.issueId,
    actorId: ctx.base.actorId,
    epoch: ctx.base.epoch,
    ...over,
  });
};

const INVERSE_RELATION: Record<string, string> = {
  start_after: "start_before",
  finish_after: "finish_before",
  blocked_by: "blocking",
  blocking: "blocked_by",
  start_before: "start_after",
  finish_before: "finish_after",
  implemented_by: "implements",
  implements: "implemented_by",
};

export const inverseRelation = (t: string): string => INVERSE_RELATION[t] ?? t;
