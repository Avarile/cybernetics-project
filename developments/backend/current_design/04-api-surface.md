# 04 — API Surface (Controllers, Pagination, Serialization, Errors)

How the ~300+ endpoints are organized as NestJS controllers, and the cross-cutting mechanisms that make the
JSON wire output byte-compatible with DRF: cursor/grouped pagination, the `fields`/`expand` dynamic
serializer, and the exact error envelopes.

## 1. Route mount map & controller layout

The five prefixes from `plane/urls.py` map to NestJS controllers via a global prefix + per-controller paths.
Because NestJS has one route table, we set controller `@Controller()` paths to carry the full Django path
(including `workspaces/:slug/...`), matching how Django flattens routes with no `include()` namespacing.

| Prefix | Module(s) | Auth guard |
|---|---|---|
| `/api/` | `workspace, project, issue, cycle, module, page, view, intake, state, estimate, label, notification, analytics, search, asset, webhook, api-token, user` | `SessionGuard` |
| `/api/public/` | `space` | `AnchorGuard` (+ `SessionGuard` on the authenticated anchor-create route) |
| `/api/instances/` | `license` | `SessionGuard` (admin cookie) |
| `/api/v1/` | `public-api` | `ApiKeyGuard` + `ApiKeyThrottleInterceptor` |
| `/auth/` | `auth` | none (creates sessions) |

### Endpoint domains & rough counts (internal app API)

Mirrors `plane/app/urls/*` (~233 route entries; more HTTP ops because ViewSets map several methods per path):

| Domain | ~routes | NestJS module |
|---|---|---|
| workspace (members, invites, favorites, home, stickies, recent-visits, prefs) | 41 | `workspace` |
| issue (+ labels, links, comments, reactions, relations, subscribers, sub-issues, activity, versions, bulk) | 40 | `issue` |
| project (+ members, invites) | 20 | `project` |
| asset (S3 upload, v2 flow) | 18 | `asset` |
| user (profile, settings, onboarding) | 16 | `user` |
| cycle (+ cycle-issues, archive) | 14 | `cycle` |
| analytics (charts, advanced) | 13 | `analytics` |
| module (+ module-issues, archive) | 13 | `module` |
| page (+ versions) | 11 | `page` |
| intake | 10 | `intake` |
| notification | 7 | `notification` |
| views (saved views) | 7 | `view` |
| estimate | 5 | `estimate` |
| state | 4 | `state` |
| webhook (+ secrets) | 4 | `webhook` |
| external (GPT/Unsplash) | 3 | `ai` |
| search (global + issue) | 3 | `search` |
| api-token | 2 | `api-token` |
| timezone | 1 | `user` (or `shared`) |
| exporter | 1 | `issue`/`analytics` (export jobs) |

### External v1 API (`/api/v1/`, `public-api` module)

Mirrors `plane/api/urls/*` (~67 routes). `work_item` (25), `cycle` (8), `module` (7), `asset` (6),
`member` (5), `project` (4), `estimate` (3), `state` (2), `intake` (2), `label` (2), `invite` (1), `user` (1),
`sticky` (1). These reuse the domain **services** but expose the v1 serializer shapes and the API-key auth +
throttle stack. (Note: Django's `api/urls/schema.py` is dead/unmounted — do not replicate those 3 routes.)

### Public spaces (`/api/public/`, `space` module)

Anonymous, anchor-based (a `DeployBoard` token): `GET anchor/:anchor/meta|settings|issues|cycles|modules|
states|labels|members`, plus anon vote/react/comment viewsets and public intake/form submission. The
authenticated `POST workspaces/:slug/projects/:projectId/anchor/` creates/fetches the anchor.

### Controller conventions
- One controller per route group; thin methods delegate to services.
- Guards attached at controller/route level (surfaces differ), not globally.
- `@Roles({...})` / class permission guards per handler (see [`03`](./03-auth-and-rbac.md) §3).
- A `@FieldsExpand()` param decorator provides `{ fields, expand }` (parsed CSV) to handlers that need it.
- Base-view conveniences (`workspace_slug`, `project_id`) become route params (`:slug`, `:project_id`/`:pk`).

## 2. Pagination

### Cursor pagination (`BasePaginator`) — exact wire shape

Cursor string = `"<value>:<offset>:<is_prev>"` (`value`=per_page, `offset`=page#, `is_prev`∈{0,1}); default
when absent = `"<per_page>:0:0"`. `per_page` from `?per_page=` (default 1000, cap 1000). Fetch `limit+1` to
detect the next page. Response envelope must match key-for-key:

```ts
export async function paginate<T>(opts: {
  req: Request; countQuery: () => Promise<number>;
  pageQuery: (offset: number, limitPlusOne: number) => Promise<T[]>;
  onResults?: (r: T[]) => any; defaultPerPage?: number; maxPerPage?: number;
}) {
  const dflt = opts.defaultPerPage ?? 1000, cap = Math.max(opts.maxPerPage ?? 1000, dflt);
  const perPage = Math.min(parseInt(opts.req.query.per_page as string ?? String(dflt), 10) || dflt, cap);
  const raw = (opts.req.query.cursor as string) ?? `${perPage}:0:0`;
  const [value, offsetStr] = raw.split(':');
  const page = parseInt(offsetStr, 10); const limit = parseInt(value, 10) || perPage;
  const rows = await opts.pageQuery(page * limit, limit + 1);
  const hasNext = rows.length > limit;
  const results = opts.onResults ? opts.onResults(rows.slice(0, limit)) : rows.slice(0, limit);
  const total = await opts.countQuery();
  return {
    grouped_by: null, sub_grouped_by: null, total_count: total,
    next_cursor: `${limit}:${page + 1}:0`, prev_cursor: `${limit}:${page - 1}:1`,
    next_page_results: hasNext, prev_page_results: page > 0,
    count: results.length, total_pages: Math.ceil(total / limit), total_results: total,
    extra_stats: null, results,
  };
}
```

### Grouped / sub-grouped pagination (issues)

`GroupedOffsetPaginator` / `SubGroupedOffsetPaginator` are a larger, issue-specific sub-task: group by a
field with `ROW_NUMBER() OVER (PARTITION BY …)`, the `FIELD_MAPPER` translating m2m fields to
`label_ids`/`assignee_ids`/`module_ids`, and nested `{results, total_results}` dicts. Implemented with
Drizzle `sql` window functions when the issue list/board endpoints are ported (Phase 2). Not needed for the
auth-critical path but the biggest pagination sub-task; `log()` any coverage limits during the build.

## 3. Dynamic `fields` / `expand` serialization

`DynamicBaseSerializer` behavior: `?fields=a,b,c` restricts top-level keys; `?expand=user,project,…` replaces
`<rel>_id` with a nested lite object (or leaves `<rel>_id` when no serializer is registered). The expansion
map and the "many" set are fixed lists in `app/serializers/base.py`.

Approach: a `FieldsExpandInterceptor` reading `req.query.fields`/`expand` (CSV → array, mirroring
`BaseAPIView.fields`/`expand`) and post-processing the handler's return value:

```ts
@Injectable()
export class FieldsExpandInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    const fields = csv(req.query.fields), expand = csv(req.query.expand);
    return next.handle().pipe(map(body => shape(body, fields, expand)));
  }
}
```

Because expansion needs related rows, the cleaner design is: handlers/repositories accept the parsed
`expand[]` and `LEFT JOIN`/batch-load requested relations (avoids N+1), then `shape()` (a) drops keys not in
`fields`, (b) for each `expand` entry maps to a registered lite-DTO (`UserLiteDTO`, `ProjectLiteDTO`,
`WorkspaceLiteDTO`, `StateLiteDTO`, `LabelDTO`, …), applying `many` for the fixed set (`members, assignees,
labels, issue_cycle, issue_relation, issue_intake, issue_reactions, issue_link, sub_issues, issue_related`).
Keep an `EXPANSION` registry matching `base.py`, including the `issue_attachments` special case (query
`FileAsset` by `issue_id` + entity_type `ISSUE_ATTACHMENT`). This makes wire output identical.

> Fidelity note: in Django's `DynamicBaseSerializer.__init__` there is a quirk where `fields = self.expand`;
> the observable behavior across the app views is that `?fields` is a top-level allowlist and `?expand` is
> relation inflation — reproduce the **observable** behavior (verified by golden-response tests).

## 4. Error envelope (exception filter)

An `AllExceptionsFilter` dispatches by exception type + path so no handler needs try/catch — reproducing the
centralized `handle_exception`/`finalize_response`. Four shapes:

1. **View-level errors** → `{ "error": "..." }`:
   | Cause | Status | Message |
   |---|---|---|
   | Integrity/constraint | 400 | `The payload is not valid` |
   | Validation | 400 | `Please provide valid detail` |
   | Not found | 404 | app/space: `The required object does not exist.` — **v1 differs**: `The requested resource does not exist.` |
   | Missing key | 400 | `The required key does not exist.` |
   | Fallback | 500 | `Something went wrong please try again later` |
   → **branch the 404 message by path** (`/api/v1/*` uses the v1 wording).
2. **RBAC** → 403 `{ "error": "You don't have the required permissions." }`.
3. **Auth failures** (custom `auth_exception_handler`) → **401** `{ "detail": "Authentication credentials were not provided." }` (DRF's default is 403; the handler rewrites to 401 — reproduce the 401).
4. **Throttled** → **429** `{ "error_code": 5900, "error_message": "RATE_LIMIT_EXCEEDED" }`.

The filter also copies `X-RateLimit-*` onto responses (v1) and applies structured logging with error codes
(matching the ViewSet variant's `logger.warning/error`).

## 5. Request/response conventions preserved

- `?fields` / `?expand` CSV params (§3) on most list/detail endpoints.
- Cursor pagination envelope (§2) on list endpoints; some v1 endpoints use offset/limit — match per endpoint.
- Timezone activation per request (Django `TimezoneMixin.initial()` sets `user_timezone`) → a small
  interceptor sets the request's effective timezone from `user.user_timezone` for date formatting.
- Read-replica opt-in (`use_read_replica=True` in Django) → repositories can target the `DRIZZLE_RO`
  provider on read-heavy list endpoints (see [`07`](./07-infra-and-integrations.md) §1).
- Webhook-emitting endpoints (Django `webhook_event="project"` etc.) enqueue `model_activity` after mutation
  (see [`05`](./05-background-jobs.md) §3).

## 6. Fidelity checklist

- [ ] Route paths match Django 1:1 (including `workspaces/:slug/projects/:project_id/...` prefixes).
- [ ] List responses reproduce the cursor envelope key-for-key (`next_cursor`, `total_pages`, …).
- [ ] `?fields`/`?expand` produce identical shaping incl. `many` relations and `issue_attachments`.
- [ ] All four error envelopes match by status **and** body (incl. per-path 404 wording).
- [ ] v1 responses carry `X-RateLimit-Remaining`/`-Reset` headers.
- [ ] Grouped/sub-grouped issue lists match Django's nested `{results, total_results}` structure.
