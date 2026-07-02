# 09 — Risks & Open Questions

Ranked risks with mitigations, plus decisions that need product/ops input before or during the build.

## 1. Ranked risks

### R1 — Session write parity requires the shared `SECRET_KEY` (High impact, Low likelihood)
For bidirectional compatibility (Django able to read NestJS-created sessions, and `_auth_user_hash`
password-invalidation parity), NestJS must sign `session_data` exactly like Django, which needs the identical
`SECRET_KEY`. **Reads never need it** (denormalized `user_id`).
- **Mitigation:** deploy NestJS with the same `SECRET_KEY` (it must match for Fernet config decryption too —
  R5 — so this is a single shared secret). If it truly cannot be shared, fall back to NestJS reading Django
  sessions and writing its own format (soft degradation, **no re-login**; Django can't read NestJS sessions).
- **Verify:** the session round-trip golden test.

### R2 — Celery message-format drift breaks task coexistence (High impact, Medium likelihood)
If the NestJS producer's body/headers or kwargs shapes differ from Django's, a Django worker silently fails
or mis-handles a NestJS-enqueued task (and vice-versa).
- **Mitigation:** the **golden-message byte-parity test** (capture a real Django message, assert equality
  modulo `id`/`origin`); a **shared TS kwargs contract per task**; **per-queue routing** so only the intended
  worker fleet consumes a task during migration; `nack(requeue=false)` as a safety net for unknown tasks.
- **Verify:** cross-execution tests both directions ([`05`](./05-background-jobs.md) §4).

### R3 — Cascade-registry fidelity (Medium impact, Medium likelihood)
The soft-delete cascade is reconstructed from a **generated static registry**, not from the DB (which doesn't
encode `on_delete`). A missing/incorrect entry means orphaned or over-deleted rows.
- **Mitigation:** **code-generate** the registry by parsing `on_delete=`/`related_name` from the Django
  models; a test that asserts **every FK column appears in the registry**; regenerate whenever the schema
  drifts (tied to the drift gate).
- **Verify:** cascade behavior tests vs Django on representative parents (issue, project, workspace, cycle).

### R4 — Schema drift as Django keeps migrating (Medium impact, Medium likelihood)
Django remains the DDL owner; a new migration can silently diverge from the Drizzle schema.
- **Mitigation:** the **CI drift gate** (Django `migrate` → `drizzle-kit pull` → diff snapshot) fails on any
  divergence; a **boot-time `django_migrations` version assertion**; a tracked `EXPECTED_MIGRATION` marker.
- **Verify:** drift gate runs on every PR.

### R5 — Fernet config parity (Medium impact, Low likelihood)
Shared encrypted `InstanceConfiguration` (LLM/SMTP/OAuth/Unsplash) must decrypt identically.
- **Mitigation:** `CryptoService` replicates PBKDF2-HMAC-SHA256(SECRET_KEY, "salt", 100000, 32) → urlsafe-b64
  → Fernet; a test decrypting a Django-written value.
- **Verify:** the Fernet parity test.

### R6 — AI provider mode ambiguity (Low impact, Medium likelihood)
Django routes all providers through the OpenAI SDK with a `gemini/` prefix — this only works behind a
LiteLLM/OpenAI-compatible gateway. Whether one is deployed determines Mode A vs Mode B.
- **Mitigation:** default to **Mode A** (gateway, byte-faithful) when `LLM_GATEWAY_URL` is set; **Mode B**
  (native Vercel-AI providers) otherwise. Document both ([`06`](./06-ai-mastra.md) §4/§7).
- **Open question:** see Q1.

### R7 — Grouped/sub-grouped issue pagination complexity (Medium impact, Medium likelihood)
The window-function grouping + `FIELD_MAPPER` + nested `{results, total_results}` is the most intricate wire
shape to reproduce.
- **Mitigation:** isolate in `infra/pagination`; drive with golden-response tests; `log()` any coverage limits.
- **Verify:** wire-parity tests on grouped issue lists.

### R8 — `DynamicBaseSerializer` quirks & expansion registry (Medium impact, Medium likelihood)
The `fields = self.expand` quirk and the fixed expansion/`many` lists must reproduce **observable** behavior.
- **Mitigation:** a maintained `EXPANSION` registry mirroring `base.py`, incl. the `issue_attachments` special
  case; golden-response tests over expanded payloads.

### R9 — `issue_activity` audit engine breadth (Medium impact, Low likelihood)
28-branch mapper + 12 diff helpers is the largest single logic port; subtle diffs change activity feeds,
notifications, and webhooks.
- **Mitigation:** port branch-by-branch with per-branch golden tests comparing emitted `IssueActivity` rows.

### R10 — Behavioral edge cases in `save()`/signals/managers (Low impact, Medium likelihood)
Python-side defaults, `post_save` signals, per-model `save()` logic, manager default filters (see
[`02`](./02-data-layer-drizzle.md) §6).
- **Mitigation:** centralized base repositories + explicit service steps; the mapping table in `02` §6 tracks
  each one.

### R11 — Volume / effort (Planning risk)
~90 models + ~300 endpoints + 47 tasks is a multi-month build.
- **Mitigation:** the phased, independently-shippable roadmap ([`08`](./08-implementation-roadmap.md)); reuse
  of two base repositories and shared interceptors keeps per-domain work mechanical after Phases 0–3.

## 2. Open questions (need input)

**Q1 — Is a LiteLLM / OpenAI-compatible gateway deployed for AI?** Determines Mode A vs Mode B and whether the
stored `LLM_API_KEY` is a gateway key or a native provider key. (Default assumed: Mode A when
`LLM_GATEWAY_URL` set.)

**Q2 — Can NestJS share `SECRET_KEY` with Django?** Strongly recommended (needed for full session write
parity **and** Fernet config decryption). If not, confirm the soft-degradation fallback is acceptable.

**Q3 — Bug-for-bug parity or fix-forward?** Two known Django quirks: the Unsplash `${page}` literal-string bug
([`06`](./06-ai-mastra.md) §5) and the `DynamicBaseSerializer` `fields = self.expand` quirk
([`04`](./04-api-surface.md) §3). Recommendation: fix the Unsplash bug, preserve the serializer's observable
behavior. Confirm.

**Q4 — Instance bootstrap ownership.** Should `register_instance`/`configure_instance` remain Django
management commands during coexistence, or be reimplemented as Nest CLI commands? (Default: keep in Django
until Django is decommissioned.)

**Q5 — Read-replica usage.** Reproduce Django's per-view `use_read_replica` opt-in exactly, or route all GET
list endpoints to the replica? (Default: mirror the opt-in.)

**Q6 — drf-spectacular / OpenAPI.** Do consumers rely on the generated schema at `/api/schema` etc.? If so,
`@nestjs/swagger` output should match closely. (Default: provide `@nestjs/swagger`, don't guarantee
byte-identical schema JSON.)

**Q7 — Test-data / seeding.** Are `create_dummy_data` / `workspace_seed` needed early (dev/demo) or can they
land in Phase 4? (Default: Phase 4, but `workspace_seed` may be needed once project creation is ported since
new workspaces seed default states/labels.)

**Q8 — EE / non-OSS features.** SAML/OIDC and other enterprise auth live outside this OSS tree. Confirm they
are **out of scope** for this port. (Default: out of scope.)

**Q9 — Deployment topology.** How many `worker`/`scheduler` replicas, and is the beat singleton enforced by
deployment (single replica) or the Redis lock? (Default: Redis lock, so replica count is flexible.)

## 3. Explicit non-goals (restated)

- Realtime collaboration (`apps/live`) — integrated with, not reimplemented.
- Replacing Django migrations — Django owns DDL throughout.
- New AI capabilities — Mastra reproduces the existing single-completion behavior only.
