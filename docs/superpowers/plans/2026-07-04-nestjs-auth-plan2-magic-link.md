# Auth Port — Plan 2: Magic Link (app + spaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Plane's passwordless magic-code auth — `magic-generate` (email a 6-digit code), `magic-sign-in`, `magic-sign-up` (app **and** `/spaces/`) — to `apps/nestjs-api`, faithful to Django's Redis-backed state machine and redirect/JSON protocol.

**Architecture:** A `MagicCodeService` reimplements Django's `MagicCodeProvider` Redis state machine (issue/verify a code with generate- and verify-attempt caps) on the existing `REDIS` ioredis provider. `magic-generate` (JSON) issues+emails the code via `MailerService`; `magic-sign-in`/`magic-sign-up` (form-POST→302, CSRF-guarded) verify it and log the user in via the existing `login-flow.util.ts`. Builds entirely on Plan 1's infra (error codes, redirect/CSRF/response helpers, session, recordLogin, EmailProvider user-creation).

**Tech Stack:** NestJS 10, ioredis (`REDIS`), nodemailer (`MailerService`), Drizzle, Vitest. Django reference: `apps/api/plane/authentication/provider/credentials/magic_code.py`, `views/app/magic.py`, `bgtasks/magic_link_code_task.py`.

**Spec:** `docs/superpowers/specs/2026-07-04-nestjs-auth-surface-design.md` (§ Magic-code state machine). Plan 1 (infra + email/password) is merged into the branch and is a hard dependency.

## Global Constraints

- Faithful Django parity: error codes VERBATIM from `adapter/error.py` (already ported in `error-codes.ts` — all magic codes exist: SMTP_NOT_CONFIGURED, MAGIC_LINK_LOGIN_DISABLED, EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN/UP, INVALID_MAGIC_CODE_SIGN_IN/UP, EXPIRED_MAGIC_CODE_SIGN_IN/UP, MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED, MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED, USER_DOES_NOT_EXIST, USER_ALREADY_EXIST). NEVER invent a code — read the Django file if unsure.
- Response families: `magic-generate` is JSON (DRF APIView; returns `{key}` on success, error dict on failure; **not** CSRF-guarded — matches Django AllowAny APIView). `magic-sign-in`/`magic-sign-up` are form-POST → 302-redirect with error-code query params, **CSRF-guarded** (reuse `CsrfGuard`).
- `INSTANCE_NOT_CONFIGURED` (5000) guard first in each endpoint (as Plan 1's EmailProvider does — reuse the same instance-setup check).
- Reuse (do NOT rebuild): `REDIS` (ioredis, `src/infra/cache/redis.module.ts`), `MailerService` (`src/infra/mailer/mailer.service.ts`), `error-codes.ts` (`AuthError`), `redirectSuccess`/`redirectError` (`auth-response.ts`), `CsrfGuard`, `getRedirectionPath`, `validateNextPath`, `login-flow.util.ts` (`completeLogin`/`recordLogin`), `EmailProvider`/user+profile creation, `InstanceConfigService` (config gates), `sessionCookieName`/`cookie.util.ts`.
- **Magic user creation:** magic-sign-up creates the user with `is_password_autoset: true` (no password) — differ from email sign-up (`is_password_autoset:false`); mirror Django `magic_code.py` `set_user_data` payload.
- Config gates via `InstanceConfigService`: `EMAIL_HOST` (→ SMTP_NOT_CONFIGURED) and `ENABLE_MAGIC_LINK_LOGIN` (== "0" → MAGIC_LINK_LOGIN_DISABLED).
- DB/Redis tests: `source "$SCRATCH/db-env.sh"` — it must export `DATABASE_URL` (plane_test) AND `REDIS_URL` pointing at a reachable test Redis (see Pre-flight; 6379 is not up by default). `SECRET_KEY`, `EMAIL_HOST` (dummy, so the SMTP gate passes) also set there. `$SCRATCH` = `/tmp/claude-1000/-home-avarile-Documents-codeRepo-plane/6bc1a023-11c9-4f3e-8425-af5a1e0711d5/scratchpad`.
- No `Co-Authored-By`; `--no-verify` only if the husky/pnpm hook is broken. Unit specs co-located `src/**/*.spec.ts`; e2e in `test/*.e2e.spec.ts`. Stage only your own files.

## Pre-flight (execution prerequisite — resolved by the controller before Task 1)

The magic state machine and its tests require a reachable **Redis**. `localhost:6379` is not up. The controller must, before dispatching, point `REDIS_URL` (in `db-env.sh`) at a reachable Redis — the k3s infra Redis (isolated DB index, e.g. db15) via `kubectl port-forward`, or a disposable local Redis — and confirm `redis-cli -u "$REDIS_URL" ping` → PONG. Every magic task's tests `source db-env.sh` and use `$REDIS_URL`. Use a dedicated DB index so tests can `FLUSHDB` safely.

---

### Task 1: `MagicCodeService` — Redis state machine

**Files:**

- Create: `apps/nestjs-api/src/modules/auth/magic/magic-code.service.ts`
- Test: `apps/nestjs-api/test/magic-code.e2e.spec.ts`

**Interfaces:**

- Consumes: `REDIS` (ioredis), `InstanceConfigService`, `DRIZZLE` (to check user-exists for the sign-in-vs-sign-up error variant), `AuthError`, `AUTHENTICATION_ERROR_CODES`.
- Produces: `class MagicCodeService { assertEnabled(email: string): Promise<void>; initiate(email: string): Promise<{ key: string; token: string }>; verify(key: string, code: string): Promise<{ email: string }> }`. `key` = `"magic_<email>"`. `assertEnabled` throws SMTP*NOT_CONFIGURED / MAGIC_LINK_LOGIN_DISABLED. `initiate` throws EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN/UP after 3 generate attempts. `verify` throws EXPIRED*/INVALID\_/EMAIL_CODE_ATTEMPT_EXHAUSTED_MAGIC_CODE_SIGN_IN|UP; on success returns `{email}` and deletes the keys.

- [ ] **Step 1: Write the failing e2e test** (against the test Redis)

```typescript
// apps/nestjs-api/test/magic-code.e2e.spec.ts  (excerpt — full matrix)
import Redis from "ioredis";
import { MagicCodeService } from "../src/modules/auth/magic/magic-code.service";
import { AUTHENTICATION_ERROR_CODES } from "../src/infra/auth/error-codes";
// build service with real REDIS + a stub InstanceConfigService returning EMAIL_HOST set, ENABLE_MAGIC_LINK_LOGIN="1"
describe("MagicCodeService", () => {
  const redis = new Redis(process.env.REDIS_URL!);
  beforeEach(() => redis.flushdb());
  afterAll(() => redis.quit());
  it("issues a 6-digit code and verifies it once (then the key is gone)", async () => {
    const { key, token } = await svc.initiate("a@b.io");
    expect(token).toMatch(/^\d{6}$/);
    expect(await svc.verify(key, token)).toEqual({
      email: "magic_a@b.io".replace("magic_", "") === "a@b.io" ? "a@b.io" : "a@b.io",
    });
    expect(await redis.exists(key)).toBe(0);
  });
  it("wrong code increments verify attempts; after 5 the token is invalidated (EXHAUSTED)", async () => {
    /* loop 5 wrong codes, assert INVALID then EXHAUSTED errorCode */
  });
  it("expired/missing key → EXPIRED_MAGIC_CODE_SIGN_*", async () => {
    /* verify a non-existent key */
  });
  it("3rd generate within TTL → EMAIL_CODE_ATTEMPT_EXHAUSTED", async () => {
    /* initiate 4x */
  });
});
```

(Write the full assertions: token regex `^\d{6}$`; success returns the bare email and deletes both `key` and `key:verify_attempts`; the sign-in vs sign-up error variant depends on whether a `users` row with that email exists — seed one for the SIGN_IN cases.)

- [ ] **Step 2: Run → RED** (`npm run test:e2e -- magic-code` → module missing).

- [ ] **Step 3: Implement** — faithful port of `apps/api/plane/authentication/provider/credentials/magic_code.py`:
  - `assertEnabled`: read `EMAIL_HOST` + `ENABLE_MAGIC_LINK_LOGIN` via `InstanceConfigService`; throw `SMTP_NOT_CONFIGURED` if no EMAIL_HOST, `MAGIC_LINK_LOGIN_DISABLED` if `== "0"`.
  - `initiate(email)`: `key="magic_"+email`; token = `String(randomInt(100000, 1000000))` (6 digits; use `crypto.randomInt`). If key exists, parse JSON, `current_attempt+1`; if stored `current_attempt > 2` → EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN (user exists) / \_SIGN_UP (not). Else `current_attempt:0`. `redis.set(key, JSON, "EX", 600)`. `redis.del(key+":verify_attempts")`. Return `{key, token}`.
  - `verify(key, code)`: if `!exists` → EXPIRED_MAGIC_CODE_SIGN_IN/UP (by user-exists). Else parse; if `token === code` → `redis.del(key)` + `del(key:verify_attempts)` → return `{email}`. Else: compute `remaining = max(1, await redis.ttl(key))`; atomic increment via `redis.eval(INCREMENT_SCRIPT, 1, key+":verify_attempts", remaining)` (the exact Lua from magic_code.py: `INCR` + first-time `EXPIRE`); if `attempts >= 5` → del keys + EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN/UP; else INVALID_MAGIC_CODE_SIGN_IN/UP. (User-exists check via a `users` lookup on the bare email.)

- [ ] **Step 4: Run → GREEN**; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(nestjs-api): MagicCodeService (Redis magic-code state machine)`

---

### Task 2: Magic-code email (template + send)

**Files:**

- Create: `apps/nestjs-api/src/modules/auth/magic/magic-email.ts` (renders subject + html/text)
- Test: `apps/nestjs-api/src/modules/auth/magic/magic-email.spec.ts`

**Interfaces:**

- Produces: `renderMagicCodeEmail(code: string): { subject: string; html: string; text: string }`, ported from `apps/api/plane/bgtasks/magic_link_code_task.py` + `templates/emails/auth/magic_signin.html` (subject + the code prominently in the body).

- [ ] **Step 1: failing unit test** — `renderMagicCodeEmail("123456")` returns a subject (matching Django's, read the task file) and `html`/`text` both containing `123456`.
- [ ] **Step 2: RED → Step 3: implement** (inline HTML string mirroring the Django template's structure; no external template engine — keep it a plain function). → **Step 4: GREEN + tsc → Step 5: Commit** `feat(nestjs-api): magic-code email renderer`.

---

### Task 3: `magic-generate` controller (JSON, app + spaces)

**Files:**

- Create: `apps/nestjs-api/src/modules/auth/magic/magic-generate.controller.ts`
- Test: `apps/nestjs-api/test/magic-generate.e2e.spec.ts`

**Interfaces:**

- Consumes: `MagicCodeService`, `MailerService`, `renderMagicCodeEmail`, `AuthJsonExceptionFilter`, the instance-setup check.
- Produces: `POST /auth/magic-generate` + `POST /auth/spaces/magic-generate` (JSON), body `{email}`, `@UseFilters(AuthJsonExceptionFilter)`; returns `{key}` (200) on success. Mirror `views/app/magic.py::MagicGenerateEndpoint`.

- [ ] **Step 1: failing e2e** — POST `{email:"m@x.io"}` (with EMAIL_HOST set in env so the gate passes) → 200 `{key:"magic_m@x.io"}`, and a `MailerService.send` spy was called with html containing the 6-digit code (inject a spy/mock MailerService in the test module, OR assert the code exists in Redis under the key). Missing email → 400 `{error_code, error_message:"INVALID_EMAIL"}` (or EMAIL_REQUIRED — match check.py/magic.py). With `ENABLE_MAGIC_LINK_LOGIN="0"` → 400 MAGIC_LINK_LOGIN_DISABLED.
- [ ] **Step 2: RED → Step 3: implement** — instance-setup check → `magic.assertEnabled(email)` → `{key, token} = initiate(email)` → `mailer.send({to: email, ...renderMagicCodeEmail(token)})` (Django enqueues a Celery task; here send directly via MailerService) → return `{key}`. Register in `auth.module.ts`. → **Step 4: GREEN + tsc → Step 5: Commit** `feat(nestjs-api): /auth/magic-generate (app+spaces)`.

---

### Task 4: `magic-sign-in` + `magic-sign-up` controllers (redirect + CSRF, app)

**Files:**

- Create: `apps/nestjs-api/src/modules/auth/magic/magic-credentials.controller.ts`
- Test: `apps/nestjs-api/test/magic-credentials.e2e.spec.ts`

**Interfaces:**

- Consumes: `MagicCodeService.verify`, `EmailProvider` (findUserByEmail + a magic user-create path with `is_password_autoset:true`), `login-flow.util.ts` (`completeLogin`/`failLogin` with `audience`), `CsrfGuard`, `validateNextPath`, `getRedirectionPath`, `AuthError`.
- Produces: `POST /auth/magic-sign-in`, `POST /auth/magic-sign-up` — form-POST (`email`/`code`/`next_path`/`csrfmiddlewaretoken`), `@UseGuards(CsrfGuard)`, 302-redirect. sign-in: code required (MAGIC*SIGN_IN_EMAIL_CODE_REQUIRED) → verify(`magic*<email>`, code) → find user (USER_DOES_NOT_EXIST if none) → completeLogin. sign-up: code required (MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED) → verify → if user exists USER_ALREADY_EXIST else create user (`is_password_autoset:true`) + profile → completeLogin. All failures → `redirectError` with the AuthError dict.

- [ ] **Step 1: failing e2e** — generate a code (via MagicCodeService directly in the test), then: get-csrf-token → form-POST magic-sign-in with the right code → 302 + session cookie + last_login_time bumped; wrong/missing code → 302 with the matching error_message (INVALID_MAGIC_CODE_SIGN_IN / MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED); no-csrf → 403. magic-sign-up for a NEW email → creates a user with `is_password_autoset=true` + 302 + cookie; for an EXISTING email → 302 with USER_ALREADY_EXIST.
- [ ] **Step 2: RED → Step 3: implement** (mirror `views/app/magic.py` MagicSignIn L64 / MagicSignUp L147; reuse `completeLogin` from login-flow.util with `audience="app"`; the magic user-create reuses the same user+profile insert as EmailProvider.signUp but with `is_password_autoset:true` and no password hash — factor a shared `createUser({email, isPasswordAutoset})` if cleaner). → **Step 4: GREEN + tsc → Step 5: Commit** `feat(nestjs-api): /auth/magic-sign-in + magic-sign-up redirect+CSRF (app)`.

---

### Task 5: Spaces variants of magic-sign-in/up

**Files:**

- Create: `apps/nestjs-api/src/modules/auth/spaces/magic-credentials-space.controller.ts`
- Test: `apps/nestjs-api/test/magic-credentials-space.e2e.spec.ts`

**Interfaces:** thin `@Controller("auth/spaces")` variant of Task 4 with `audience="space"`, reusing the same `MagicCodeService` + `login-flow.util.ts`. (`/auth/spaces/magic-generate` was already added in Task 3.)

- [ ] **Step 1: failing e2e smoke** — generate a code, form-POST `/auth/spaces/magic-sign-in` with csrf + code → 302 whose Location starts with the SPACE base URL + session cookie set.
- [ ] **Step 2: RED → Step 3: implement** (delegate to the same flow, `audience="space"`). → **Step 4: GREEN + tsc → Step 5: Commit** `feat(nestjs-api): magic-sign-in/up spaces variants`.

---

### Task 6: Wiring + full verification

**Files:**

- Modify: `apps/nestjs-api/src/modules/auth/auth.module.ts` (register the magic controllers + `MagicCodeService`)

- [ ] **Step 1** Confirm all magic controllers + `MagicCodeService` are registered in `AuthModule` and reachable; add any missing wiring.
- [ ] **Step 2** `npx tsc --noEmit` clean; full `npm run test:e2e` — all magic suites green; the only failures are the 3 known pre-existing Redis-X-Api-Key ones (name them) IF the test Redis isn't the one they need — otherwise note they now pass too. `npm run test:unit` all pass.
- [ ] **Step 3** Manual smoke (app on :8000 with REDIS*URL + EMAIL_HOST set): `curl -sX POST .../auth/magic-generate -d email=...` → `{key}`; read the code from Redis (`redis-cli GET magic*<email>`); get-csrf-token; form-POST magic-sign-in with the code → 302 + session cookie.
- [ ] **Step 4: Commit** `feat(nestjs-api): wire magic-link module; Plan 2 complete`.

---

## Self-Review

**Spec coverage (Plan 2 slice):** state machine → Task 1; email → Task 2; magic-generate → Task 3; magic-sign-in/up → Task 4; spaces → Task 5; wiring → Task 6. All magic error codes exist in `error-codes.ts` (Plan 1 Task 2). Deferred to later plans: password-reset (Plan 3), OAuth (Plan 4).

**Placeholder check:** the state-machine and email are ported from named Django files with exact line refs, complete signatures, and real failing tests; the Redis Lua script is copied verbatim from `magic_code.py`.

**Type consistency:** `MagicCodeService.initiate → {key, token}` / `verify(key, code) → {email}` used consistently across Tasks 1/3/4/5; `completeLogin(audience)` matches Plan 1's `login-flow.util.ts`; `renderMagicCodeEmail(code) → {subject,html,text}` matches Task 2↔3.

**Prerequisite flagged:** Redis reachability (Pre-flight) — resolved by the controller before Task 1, not a code task.
