# 09 — Risks & Open Questions

Ranked risks with mitigations, plus decisions that need product/ops input before or during the build.

## 1. Ranked risks

### R1 — Session write parity requires the shared `SECRET_KEY` — ✅ RESOLVED (decision: share it)
**Decision (Q2): NestJS runs with Django's identical `SECRET_KEY`.** This gives full bidirectional session
compatibility (Django can read NestJS-created sessions, `_auth_user_hash` password-invalidation parity holds)
**and** Fernet config parity (R5) from a single shared secret. Reads never needed it anyway (denormalized
`user_id`). The soft-degradation fallback is **no longer required**.
- **Operational note:** `SECRET_KEY` is now a hard deployment dependency — the NestJS app must fail fast on
  boot if it is missing or differs from Django's (add a startup assertion).
- **Verify:** the session round-trip golden test (Django cookie ↔ NestJS, both directions).

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

### R5 — Fernet config parity (Low, given R1 resolved)
Shared encrypted `InstanceConfiguration` (LLM/SMTP/OAuth/Unsplash) must decrypt identically. With the shared
`SECRET_KEY` decision (R1/Q2) confirmed, this reduces to implementation correctness.
- **Mitigation:** `CryptoService` replicates PBKDF2-HMAC-SHA256(SECRET_KEY, "salt", 100000, 32) → urlsafe-b64
  → Fernet; a test decrypting a Django-written value.
- **Verify:** the Fernet parity test.

### R6 — AI provider mode — ✅ RESOLVED (decision: Mode A, gateway)
**Decision (Q1): the current Django backend does have AI, so we replicate its actual behavior — Mode A**
(single key routed through a LiteLLM/OpenAI-compatible gateway with the `gemini/` model prefix). This is a
byte-faithful match of `get_llm_response`. Mode B (native Vercel-AI providers) remains documented as an
opt-in for future native-key deployments ([`06`](./06-ai-mastra.md) §4/§7), selected by the presence/absence
of `LLM_GATEWAY_URL`.
- **Verify:** AI contract golden test (request → response shape) against the gateway.

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

## 2. Open questions

### ✅ Resolved

**Q1 — LiteLLM / OpenAI-compatible gateway for AI? → YES (Mode A).** The current Django backend has AI, so we
replicate its actual behavior: single key via a gateway with the `gemini/` prefix. `LLM_API_KEY` is treated
as the gateway key; `LLM_GATEWAY_URL` selects Mode A. See R6, [`06`](./06-ai-mastra.md) §4/§7.

**Q2 — Share `SECRET_KEY` with Django? → YES.** NestJS runs with Django's identical `SECRET_KEY`, enabling
full bidirectional session parity + Fernet config parity. Startup asserts the key is present. See R1/R5.

**Q3 — Bug-for-bug or fix-forward? → FIX-FORWARD.** Fix the Unsplash `${page}` bug
([`06`](./06-ai-mastra.md) §5) and implement clean `fields`/`expand` semantics (fields = independent
top-level allowlist; expand = relation inflation), **not** the `DynamicBaseSerializer` `fields = self.expand`
internal quirk ([`04`](./04-api-surface.md) §3). Wire-parity golden tests guard against any frontend that
depended on the old observable output; surface (don't silently absorb) any divergence.

### Still need input

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
