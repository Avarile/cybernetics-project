import { sql, type SQL } from "drizzle-orm";

/**
 * Faithful port of plane/utils/issue_filters.py.
 *
 * Produces SQL WHERE conditions (ANDed) against the base issues table, which the caller aliases as `i`.
 * Both request modes are supported: "GET" (comma-separated strings from the query string) and "POST"
 * (already-arrays, e.g. a saved AnalyticView.query_dict) — matching Django's two branches.
 *
 * Relational filters (labels/assignees/cycle/module/subscriber) use EXISTS subqueries so they narrow the
 * issue set without inflating it (the grouping dimension in build_graph_plot owns the intentional fan-out).
 */
export type FilterMethod = "GET" | "POST";
type Params = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toList(params: Params, key: string, method: FilterMethod): string[] {
  const v = params[key];
  if (v == null) return [];
  if (method === "GET") {
    return String(v)
      .split(",")
      .filter((x) => x !== "null");
  }
  if (Array.isArray(v)) return v.map(String);
  return v === "null" || v === "" ? [] : [String(v)];
}

const validUuids = (list: string[]): string[] => list.filter((x) => UUID_RE.test(x));

/** `<col> IN (v1, v2, ...)` with parameterised values. */
function inList(col: SQL, values: string[]): SQL {
  return sql`${col} IN (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}

const DATE_REL = /^\d+_(weeks|months)$/;

/** Port of date_filter(): supports absolute after/before and relative N_weeks/N_months;offset. */
function dateConditions(colExpr: SQL, queries: string[]): SQL[] {
  const out: SQL[] = [];
  for (const query of queries) {
    const parts = query.split(";");
    if (parts.length >= 2) {
      if (DATE_REL.test(parts[0])) {
        if (parts.length === 3) {
          const [digitStr, term] = parts[0].split("_");
          const duration = parseInt(digitStr, 10);
          const subsequent = parts[1]; // after | before
          const offset = parts[2]; // fromnow | ...
          const days = term === "months" ? duration * 30 : duration * 7;
          const sign = offset === "fromnow" ? days : -days;
          const op = subsequent === "after" ? sql`>=` : sql`<=`;
          out.push(sql`${colExpr} ${op} (CURRENT_DATE + ${sign} * INTERVAL '1 day')`);
        }
      } else if (parts.includes("after")) {
        out.push(sql`${colExpr} >= ${parts[0]}`);
      } else {
        out.push(sql`${colExpr} <= ${parts[0]}`);
      }
    } else if (parts.length === 1 && parts[0] !== "") {
      // Django's `__contains` on a date is effectively an exact-day match here.
      out.push(sql`${colExpr}::text LIKE ${"%" + parts[0] + "%"}`);
    }
  }
  return out;
}

const existsJoin = (table: string, alias: string, extra: SQL): SQL =>
  sql`EXISTS (SELECT 1 FROM ${sql.raw(table)} ${sql.raw(alias)} WHERE ${sql.raw(alias)}.issue_id = i.id AND ${sql.raw(alias)}.deleted_at IS NULL AND ${extra})`;

const notExistsJoin = (table: string, alias: string): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${sql.raw(table)} ${sql.raw(alias)} WHERE ${sql.raw(alias)}.issue_id = i.id AND ${sql.raw(alias)}.deleted_at IS NULL)`;

/**
 * Build the AND-conditions for the given params. `i` is the assumed alias of the issues table.
 * Unported filters (mentions/logged_by/intake status) are intentionally skipped — see the roadmap.
 */
export function buildIssueFilters(params: Params, method: FilterMethod): SQL[] {
  const c: SQL[] = [];

  if ("state" in params) {
    const states = validUuids(toList(params, "state", method));
    if (states.length) c.push(inList(sql`i.state_id`, states));
  }

  if ("state_group" in params) {
    const groups = toList(params, "state_group", method);
    if (groups.length) c.push(sql`i.state_id IN (SELECT id FROM states WHERE "group" IN (${sql.join(groups.map((g) => sql`${g}`), sql`, `)}))`);
  }

  if ("estimate_point" in params) {
    const pts = toList(params, "estimate_point", method);
    if (pts.length) c.push(inList(sql`i.estimate_point_id`, pts));
  }

  if ("priority" in params) {
    const p = toList(params, "priority", method);
    if (p.length) c.push(inList(sql`i.priority`, p));
  }

  if ("parent" in params) {
    const raw = toList(params, "parent", method);
    if (raw.includes("None")) c.push(sql`i.parent_id IS NULL`);
    const parents = validUuids(raw);
    if (parents.length) c.push(inList(sql`i.parent_id`, parents));
  }

  if ("labels" in params) {
    const raw = toList(params, "labels", method);
    if (raw.includes("None")) c.push(notExistsJoin("issue_labels", "il"));
    const labels = validUuids(raw);
    if (labels.length) c.push(existsJoin("issue_labels", "il", inList(sql`il.label_id`, labels)));
  }

  if ("assignees" in params) {
    const raw = toList(params, "assignees", method);
    if (raw.includes("None")) c.push(notExistsJoin("issue_assignees", "ia"));
    const assignees = validUuids(raw);
    if (assignees.length) c.push(existsJoin("issue_assignees", "ia", inList(sql`ia.assignee_id`, assignees)));
  }

  if ("created_by" in params) {
    const raw = toList(params, "created_by", method);
    if (raw.includes("None")) c.push(sql`i.created_by IS NULL`);
    const users = validUuids(raw);
    if (users.length) c.push(inList(sql`i.created_by`, users));
  }

  if ("name" in params && String(params.name ?? "") !== "") {
    c.push(sql`i.name ILIKE ${"%" + String(params.name) + "%"}`);
  }

  if ("created_at" in params) {
    const q = toList(params, "created_at", method);
    if (q.length) c.push(...dateConditions(sql`i.created_at::date`, q));
  }

  if ("updated_at" in params) {
    // Django maps updated_at onto created_at__date (a source quirk); replicate faithfully.
    const q = toList(params, "updated_at", method);
    if (q.length) c.push(...dateConditions(sql`i.created_at::date`, q));
  }

  if ("start_date" in params) {
    if (method === "GET") {
      const q = String(params.start_date ?? "").split(",").filter((x) => x !== "");
      if (q.length) c.push(...dateConditions(sql`i.start_date`, q));
    } else if (params.start_date) {
      c.push(sql`i.start_date = ${String(params.start_date)}`);
    }
  }

  if ("target_date" in params) {
    if (method === "GET") {
      const q = String(params.target_date ?? "").split(",").filter((x) => x !== "");
      if (q.length) c.push(...dateConditions(sql`i.target_date`, q));
    } else if (params.target_date) {
      c.push(sql`i.target_date = ${String(params.target_date)}`);
    }
  }

  if ("completed_at" in params) {
    const q = toList(params, "completed_at", method);
    if (q.length) c.push(...dateConditions(sql`i.completed_at::date`, q));
  }

  if ("type" in params) {
    const type = String(params.type ?? "all");
    let group = ["backlog", "unstarted", "started", "completed", "cancelled"];
    if (type === "backlog") group = ["backlog"];
    if (type === "active") group = ["unstarted", "started"];
    c.push(sql`i.state_id IN (SELECT id FROM states WHERE "group" IN (${sql.join(group.map((g) => sql`${g}`), sql`, `)}))`);
  }

  if ("project" in params) {
    const projects = validUuids(toList(params, "project", method));
    if (projects.length) c.push(inList(sql`i.project_id`, projects));
  }

  if ("cycle" in params) {
    const raw = toList(params, "cycle", method);
    if (raw.includes("None")) c.push(notExistsJoin("cycle_issues", "ci"));
    const cycles = validUuids(raw);
    if (cycles.length) c.push(existsJoin("cycle_issues", "ci", inList(sql`ci.cycle_id`, cycles)));
  }

  if ("module" in params) {
    const raw = toList(params, "module", method);
    if (raw.includes("None")) c.push(notExistsJoin("module_issues", "mi"));
    const modules = validUuids(raw);
    if (modules.length) c.push(existsJoin("module_issues", "mi", inList(sql`mi.module_id`, modules)));
  }

  if ("subscriber" in params) {
    const subs = validUuids(toList(params, "subscriber", method));
    if (subs.length) c.push(existsJoin("issue_subscribers", "isub", inList(sql`isub.subscriber_id`, subs)));
  }

  if ("sub_issue" in params) {
    if (String(params.sub_issue ?? "false") === "false") c.push(sql`i.parent_id IS NULL`);
  }

  if ("start_target_date" in params && String(params.start_target_date) === "true") {
    c.push(sql`i.target_date IS NOT NULL`);
    c.push(sql`i.start_date IS NOT NULL`);
  }

  return c;
}
