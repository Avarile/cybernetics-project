# Auth Port — Plan 1: Infra + Email/Password (app + spaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make account creation and login work end-to-end in the web app by porting the shared auth infrastructure (redirect-safety, CSRF, error codes, rate-limit) plus the email/password + email-check + get-csrf-token endpoints (app **and** `/spaces/`) into `apps/nestjs-api`, faithful to Django's protocol.

**Architecture:** New `infra/auth/*` foundation (redirect/CSRF/error-codes/exception mapping/redirection-path) + a `modules/auth/email` provider and thin app/space controllers. Reuses the already-Django-compatible session, password-hash, cookie, and config code. Redirect-family endpoints 302 with error-code query params; JSON-family return the error dict; form-POST endpoints are CSRF-protected via double-submit cookie.

**Tech Stack:** NestJS 10, Express, Drizzle, Vitest, `@nestjs/throttler`, `zxcvbn`. Django reference: `apps/api/plane/authentication/`.

**Spec:** `docs/superpowers/specs/2026-07-04-nestjs-auth-surface-design.md`

## Global Constraints

- Faithful Django protocol: JSON endpoints return `{error_code, error_message, ...payload}` with the HTTP status Django uses; form-POST endpoints 302-redirect to `getSafeRedirectUrl(baseHost(req,audience), nextPath, params)` (success = no error params).
- CSRF double-submit on form-POST endpoints only; pre-login JSON endpoints skip CSRF (matches Django).
- Reuse (do NOT rebuild): `infra/auth/session.service.ts` (`sessions.create`/`resolve`/`destroy`), `session.crypto.ts`, `infra/auth/django-password.ts` (`verifyDjangoPassword`/`makeDjangoPassword`), `modules/auth/cookie.util.ts` (`sessionCookieName`/`setSessionCookie`/`clearSessionCookie`/`buildDeviceInfo`), `infra/config/instance-config.service.ts`.
- Audience is `"app" | "space"`; redirect base = `APP_BASE_URL`→`WEB_URL` (app) or `SPACE_BASE_URL`→`WEB_URL`+`SPACE_BASE_PATH` (space). Env read via `ConfigService`.
- DB tests: `source "$SCRATCH/db-env.sh"` (`DATABASE_URL=plane_test@localhost:30898`, `SECRET_KEY`). `$SCRATCH` = `/tmp/claude-1000/-home-avarile-Documents-codeRepo-plane/6bc1a023-11c9-4f3e-8425-af5a1e0711d5/scratchpad`.
- No `Co-Authored-By` trailer; `--no-verify` only if the husky/pnpm pre-commit hook is still broken.
- New schema follows the standalone conventions from the DB-bootstrap work (baseColumns `created_by`/`updated_by`; parity-check divergence rules; migrations via `npm run db:generate`, reference = `plane` DB on :30898).

---

### Task 1: Dependencies + auth rate-limit module

**Files:**

- Modify: `apps/nestjs-api/package.json`
- Create: `apps/nestjs-api/src/infra/auth/auth-throttle.ts`

**Interfaces:**

- Produces: `AUTH_THROTTLER` `ThrottlerModule` config; `authThrottleFromConfig(cfg: ConfigService): {ttl:number, limit:number}` parsing `AUTHENTICATION_RATE_LIMIT` (default `"10/minute"`).

- [ ] **Step 1: Add dependencies**

```bash
cd apps/nestjs-api
npm install @nestjs/throttler zxcvbn && npm install -D @types/zxcvbn
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/nestjs-api/test/auth-throttle.spec.ts
import { describe, expect, it } from "vitest";
import { parseRateLimit } from "../src/infra/auth/auth-throttle";
describe("parseRateLimit", () => {
  it("parses '10/minute' to { limit:10, ttl:60000 }", () => {
    expect(parseRateLimit("10/minute")).toEqual({ limit: 10, ttl: 60000 });
  });
  it("falls back to 10/minute on garbage", () => {
    expect(parseRateLimit("nonsense")).toEqual({ limit: 10, ttl: 60000 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/nestjs-api && npm run test:unit -- auth-throttle`
Expected: FAIL — cannot find `parseRateLimit`.

- [ ] **Step 4: Implement**

```typescript
// apps/nestjs-api/src/infra/auth/auth-throttle.ts
const UNIT_MS: Record<string, number> = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 };
/** Mirror plane/authentication/rate_limit.py "<count>/<unit>" (default 10/minute). */
export function parseRateLimit(raw: string | undefined): { limit: number; ttl: number } {
  const m = /^(\d+)\/(second|minute|hour|day)$/.exec((raw ?? "").trim());
  if (!m) return { limit: 10, ttl: 60000 };
  return { limit: Number(m[1]), ttl: UNIT_MS[m[2]] };
}
```

- [ ] **Step 5: Run test to verify it passes** — `npm run test:unit -- auth-throttle` → PASS. Then `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/nestjs-api/package.json apps/nestjs-api/package-lock.json apps/nestjs-api/src/infra/auth/auth-throttle.ts apps/nestjs-api/test/auth-throttle.spec.ts
git commit -m "feat(nestjs-api): add throttler+zxcvbn deps and auth rate-limit parser"
```

---

### Task 2: Error codes + `AuthError`

**Files:**

- Create: `apps/nestjs-api/src/infra/auth/error-codes.ts`
- Test: `apps/nestjs-api/test/auth-error.spec.ts`

**Interfaces:**

- Produces: `AUTHENTICATION_ERROR_CODES: Record<string, number>` (verbatim from Django); `class AuthError extends Error { constructor(opts:{code:number|string, message:string, payload?:Record<string,string>}); readonly status: number; getErrorDict(): {error_code:string, error_message:string} & Record<string,string> }`. Default `status` 400; `RATE_LIMIT_EXCEEDED` → 429.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/nestjs-api/test/auth-error.spec.ts
import { describe, expect, it } from "vitest";
import { AUTHENTICATION_ERROR_CODES, AuthError } from "../src/infra/auth/error-codes";
describe("AuthError", () => {
  it("builds the error dict with payload merged", () => {
    const e = new AuthError({
      code: AUTHENTICATION_ERROR_CODES.INVALID_EMAIL,
      message: "INVALID_EMAIL",
      payload: { email: "x@y.z" },
    });
    expect(e.getErrorDict()).toEqual({
      error_code: String(AUTHENTICATION_ERROR_CODES.INVALID_EMAIL),
      error_message: "INVALID_EMAIL",
      email: "x@y.z",
    });
  });
  it("known codes exist", () => {
    for (const k of [
      "INSTANCE_NOT_CONFIGURED",
      "EMAIL_REQUIRED",
      "INVALID_EMAIL",
      "USER_DOES_NOT_EXIST",
      "AUTHENTICATION_FAILED",
      "RATE_LIMIT_EXCEEDED",
    ])
      expect(typeof AUTHENTICATION_ERROR_CODES[k]).toBe("number");
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm run test:unit -- auth-error` → cannot find module.

- [ ] **Step 3: Implement — transcribe the Django codes verbatim**

Port `AUTHENTICATION_ERROR_CODES` **verbatim** (same keys, same int values) from `apps/api/plane/authentication/adapter/error.py` (the full 5000–5999 dict) into a TS `export const AUTHENTICATION_ERROR_CODES = { ... } as const`. Then:

```typescript
// append to error-codes.ts
export class AuthError extends Error {
  readonly errorCode: string;
  readonly payload: Record<string, string>;
  readonly status: number;
  constructor(opts: { code: number | string; message: string; payload?: Record<string, string> }) {
    super(opts.message);
    this.errorCode = String(opts.code);
    this.payload = opts.payload ?? {};
    this.status = String(opts.code) === String(AUTHENTICATION_ERROR_CODES.RATE_LIMIT_EXCEEDED) ? 429 : 400;
  }
  getErrorDict(): Record<string, string> {
    return { error_code: this.errorCode, error_message: this.message, ...this.payload };
  }
}
```

- [ ] **Step 4: Run to verify PASS** — `npm run test:unit -- auth-error` → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/nestjs-api/src/infra/auth/error-codes.ts apps/nestjs-api/test/auth-error.spec.ts
git commit -m "feat(nestjs-api): port AUTHENTICATION_ERROR_CODES + AuthError"
```

---

### Task 3: Redirect-safety helpers

**Files:**

- Create: `apps/nestjs-api/src/infra/auth/redirect.ts`
- Test: `apps/nestjs-api/test/auth-redirect.spec.ts`

**Interfaces:**

- Consumes: `ConfigService`.
- Produces: `type Audience = "app" | "space" | "admin"`; `baseHost(cfg: ConfigService, audience: Audience): string`; `validateNextPath(p: string | undefined): string` (returns a safe relative path or `""`); `getAllowedHosts(cfg): string[]`; `getSafeRedirectUrl(cfg, baseUrl: string, nextPath: string, params: Record<string,string>): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/nestjs-api/test/auth-redirect.spec.ts
import { describe, expect, it } from "vitest";
import { validateNextPath, getSafeRedirectUrl } from "../src/infra/auth/redirect";
const cfg = {
  get: (k: string, d?: string) =>
    (({ APP_BASE_URL: "http://localhost:3000", WEB_URL: "http://localhost:3000" }) as Record<string, string>)[k] ?? d,
} as any;
describe("redirect safety", () => {
  it("rejects absolute/scheme/parent paths, keeps safe relative", () => {
    expect(validateNextPath("http://evil.com/x")).toBe("");
    expect(validateNextPath("//evil.com")).toBe("");
    expect(validateNextPath("../../etc")).toBe("");
    expect(validateNextPath("javascript:alert(1)")).toBe("");
    expect(validateNextPath("/workspace-slug/projects")).toBe("/workspace-slug/projects");
  });
  it("builds base/?next_path=..&error params, host-guarded", () => {
    const url = getSafeRedirectUrl(cfg, "http://localhost:3000", "/x", {
      error_code: "5060",
      error_message: "USER_DOES_NOT_EXIST",
    });
    expect(url.startsWith("http://localhost:3000/?")).toBe(true);
    expect(url).toContain("error_code=5060");
    expect(url).toContain("next_path=%2Fx");
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — cannot find module.

- [ ] **Step 3: Implement — port from Django**

Translate to TS matching the signatures above, faithfully mirroring: `validate_next_path`/`get_safe_redirect_url` (`apps/api/plane/utils/path_validator.py:105,137-181`), `get_allowed_hosts` (`path_validator.py:91-102`), and `base_host` (`apps/api/plane/authentication/utils/host.py:16-63`). Rules: `validateNextPath` returns `""` unless the input is relative (no scheme, no `//`, no `..`, not starting with a control/script token); `getAllowedHosts` = netlocs of `WEB_URL`/`APP_BASE_URL`/`ADMIN_BASE_URL`/`SPACE_BASE_URL`; `getSafeRedirectUrl` builds `${base.replace(/\/$/,'')}/?${new URLSearchParams({next_path, ...params})}` and, if the resulting URL's host isn't allowed, returns `${base}/?${params}` (no next_path). `baseHost`: audience `app`→`APP_BASE_URL||WEB_URL`; `space`→`SPACE_BASE_URL||(WEB_URL + SPACE_BASE_PATH)`; `admin`→`ADMIN_BASE_URL||(WEB_URL + ADMIN_BASE_PATH)`.

- [ ] **Step 4: Run to verify PASS**; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git commit -m "feat(nestjs-api): port auth redirect-safety helpers (base_host/next_path/safe-redirect)"`

---

### Task 4: Auth response helpers + JSON exception filter

**Files:**

- Create: `apps/nestjs-api/src/infra/auth/auth-response.ts`
- Create: `apps/nestjs-api/src/infra/auth/auth-exception.filter.ts`
- Test: `apps/nestjs-api/test/auth-response.spec.ts`

**Interfaces:**

- Consumes: `AuthError`, `getSafeRedirectUrl`, `baseHost`, `ConfigService`, `getRedirectionPath` (Task 6, imported lazily — controllers pass the resolved nextPath so this file does not depend on Task 6).
- Produces: `redirectSuccess(cfg, res, req, audience, nextPath: string): void` (302 to safe URL, no error params); `redirectError(cfg, res, req, audience, err: AuthError, nextPath: string): void` (302 with `err.getErrorDict()` params); `@Catch(AuthError) class AuthJsonExceptionFilter` (sets `res.status(err.status).json(err.getErrorDict())`).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/nestjs-api/test/auth-response.spec.ts
import { describe, expect, it, vi } from "vitest";
import { redirectError } from "../src/infra/auth/auth-response";
import { AuthError, AUTHENTICATION_ERROR_CODES } from "../src/infra/auth/error-codes";
const cfg = {
  get: (k: string, d?: string) =>
    (({ APP_BASE_URL: "http://localhost:3000", WEB_URL: "http://localhost:3000" }) as Record<string, string>)[k] ?? d,
} as any;
describe("redirectError", () => {
  it("302s to base/? with the error dict", () => {
    const res: any = { redirect: vi.fn() };
    const err = new AuthError({ code: AUTHENTICATION_ERROR_CODES.USER_DOES_NOT_EXIST, message: "USER_DOES_NOT_EXIST" });
    redirectError(cfg, res, {} as any, "app", err, "");
    expect(res.redirect).toHaveBeenCalledTimes(1);
    expect(String(res.redirect.mock.calls[0][0])).toContain("error_message=USER_DOES_NOT_EXIST");
  });
});
```

- [ ] **Step 2: Run FAIL → Step 3: Implement**

```typescript
// auth-response.ts
import type { Response, Request } from "express";
import type { ConfigService } from "../config/config.service";
import { AuthError } from "./error-codes";
import { baseHost, getSafeRedirectUrl, type Audience } from "./redirect";
export function redirectSuccess(
  cfg: ConfigService,
  res: Response,
  req: Request,
  audience: Audience,
  nextPath: string
): void {
  res.redirect(getSafeRedirectUrl(cfg, baseHost(cfg, audience), nextPath, {}));
}
export function redirectError(
  cfg: ConfigService,
  res: Response,
  req: Request,
  audience: Audience,
  err: AuthError,
  nextPath: string
): void {
  res.redirect(getSafeRedirectUrl(cfg, baseHost(cfg, audience), nextPath, err.getErrorDict()));
}
```

```typescript
// auth-exception.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { AuthError } from "./error-codes";
@Catch(AuthError)
export class AuthJsonExceptionFilter implements ExceptionFilter {
  catch(err: AuthError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(err.status).json(err.getErrorDict());
  }
}
```

- [ ] **Step 4: PASS + tsc clean → Step 5: Commit** — `git commit -m "feat(nestjs-api): auth redirect/JSON response helpers + AuthError filter"`

---

### Task 5: CSRF (service + guard + get-csrf-token controller)

**Files:**

- Create: `apps/nestjs-api/src/infra/auth/csrf.service.ts`, `csrf.guard.ts`
- Create: `apps/nestjs-api/src/modules/auth/csrf.controller.ts`
- Test: `apps/nestjs-api/test/csrf.e2e.spec.ts`

**Interfaces:**

- Produces: `CsrfService.issue(res): string` (random 32-byte hex token, sets `csrftoken` cookie via config attrs, returns token); `CsrfService.validate(req): boolean` (cookie `csrftoken` === body `csrfmiddlewaretoken` || header `x-csrftoken`, constant-time); `@Injectable() CsrfGuard implements CanActivate` (throws `ForbiddenException` when `validate` false); `GET /auth/get-csrf-token` → `{ csrf_token }`.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// apps/nestjs-api/test/csrf.e2e.spec.ts
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
describe("CSRF", () => {
  let app: any;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());
  it("get-csrf-token returns a token and sets the cookie", async () => {
    const res = await request(app.getHttpServer()).get("/auth/get-csrf-token").expect(200);
    expect(typeof res.body.csrf_token).toBe("string");
    expect((res.headers["set-cookie"] || []).join(";")).toContain("csrftoken=");
  });
});
```

- [ ] **Step 2: FAIL → Step 3: Implement** the `CsrfService` (use `crypto.randomBytes(32).toString("hex")`; cookie attrs from `CSRF_COOKIE_DOMAIN`/`_SAMESITE`/`_SECURE`, httpOnly=false so the frontend can read+resubmit), `CsrfGuard` (constant-time compare via `crypto.timingSafeEqual`), and the controller (`@Controller("auth")` `@Get("get-csrf-token")`). Also register `/auth/spaces/get-csrf-token` (same handler, second `@Get`).

- [ ] **Step 4: PASS → Step 5: Commit** — `git commit -m "feat(nestjs-api): CSRF double-submit service+guard + get-csrf-token"`

---

### Task 6: `getRedirectionPath`

**Files:**

- Create: `apps/nestjs-api/src/infra/auth/redirection-path.ts`
- Test: `apps/nestjs-api/test/redirection-path.e2e.spec.ts`

**Interfaces:**

- Consumes: `DRIZZLE` `Database`, `users`/`workspaces`/`workspace_members`/`workspace_member_invites` (invites from Task 7).
- Produces: `getRedirectionPath(db: Database, user: { id: string; email: string }): Promise<string>` → `"onboarding"` (no profile onboarded) | first workspace slug the user is a member of | `"invitations"` (has pending invite, no workspace) | `"create-workspace"`. Port `apps/api/plane/authentication/utils/redirection_path.py:8-46`.

- [ ] **Step 1: failing e2e** asserting a member user routes to their workspace slug and a fresh user routes to `onboarding`/`create-workspace` (seed rows via raw SQL in `beforeAll`, source `$SCRATCH/db-env.sh`).
- [ ] **Step 2: FAIL → Step 3: Implement** per the Django logic. → **Step 4: PASS → Step 5: Commit** `feat(nestjs-api): getRedirectionPath (post-login route)`.

---

### Task 7: `workspace_member_invites` schema + migration

**Files:**

- Create: `apps/nestjs-api/src/modules/workspace/workspace-member-invite.schema.ts`
- Modify: `apps/nestjs-api/src/infra/database/schema/index.ts`
- Test: parity via `scripts/schema-parity-check.ts`

- [ ] **Step 1** Introspect the reference: `source "$SCRATCH/db-env.sh"; psql "$REF_DB_URL" -c "\d workspace_member_invites"`.
- [ ] **Step 2** Write the Drizzle schema reconciled to those columns (baseColumns with the `created_by`/`updated_by` standalone convention; JS `$defaultFn` for Django-defaulted columns), export from `schema/index.ts`.
- [ ] **Step 3** `source "$SCRATCH/db-env.sh"; cd apps/nestjs-api; npm run db:generate`; recreate `plane_test` clean; `DATABASE_URL=$TEST_DB_URL npm run db:migrate`; run the parity check (expect OK incl. the new table). `npx tsc --noEmit` clean.
- [ ] **Step 4: Commit** `feat(nestjs-api): add workspace_member_invites schema + migration`.

---

### Task 8: Email auth provider (service)

**Files:**

- Modify: `apps/nestjs-api/src/modules/auth/auth.service.ts` (extend) OR Create: `apps/nestjs-api/src/modules/auth/email.provider.ts`
- Test: `apps/nestjs-api/test/email-provider.e2e.spec.ts`

**Interfaces:**

- Consumes: `DRIZZLE`, `InstanceConfigService`, `verifyDjangoPassword`/`makeDjangoPassword`, `users`/`profiles`, `AuthError`.
- Produces: `emailCheck(email: string): Promise<{ existing: boolean; status: "MAGIC_CODE" | "CREDENTIAL" }>` (mirror `views/app/check.py:29-103`); `signUp(email: string, password: string): Promise<User>` (gate `ENABLE_EMAIL_PASSWORD` AND `ENABLE_SIGNUP` — with the `workspace_member_invites`-by-email bypass when signup disabled, per `adapter/base.py`; `zxcvbn(password).score < 3` → **`PASSWORD_TOO_WEAK`** (5021); reject existing email → `USER_ALREADY_EXIST`; create user (`makeDjangoPassword`, `is_password_autoset:false`, `is_active:true`, timestamps — same fields as `admin-seed.service.ts`) + `profiles` row); `signIn(email, password): Promise<User>` (existing `verifyCredentials`; gate `ENABLE_EMAIL_PASSWORD`; not-found → `USER_DOES_NOT_EXIST`, bad password → **`AUTHENTICATION_FAILED_SIGN_IN`** (5065), deactivated (Django keys on `last_logout_time`) → `USER_ACCOUNT_DEACTIVATED`). All failures throw `AuthError`. **Error codes MUST match Django source verbatim (spec = faithful parity); the frontend switches on the exact codes.**

- [ ] **Step 1: failing e2e** — `emailCheck` returns `{existing:false,status:"CREDENTIAL"}` for an unknown email when magic disabled; `signUp` creates a user+profile and `signUp` twice throws `USER_ALREADY_EXIST`; weak password throws `INVALID_PASSWORD`. (Reset the users/profiles rows for the test email in `beforeAll`.)
- [ ] **Step 2: FAIL → Step 3: Implement** reusing the `admin-seed.service.ts` insert shape for user+profile. → **Step 4: PASS → Step 5: Commit** `feat(nestjs-api): email auth provider (email-check/sign-up/sign-in)`.

---

### Task 9: email-check controller (app + spaces)

**Files:**

- Create: `apps/nestjs-api/src/modules/auth/email-check.controller.ts`
- Test: `apps/nestjs-api/test/email-check.e2e.spec.ts`

**Interfaces:**

- Consumes: email provider `emailCheck`, `AuthJsonExceptionFilter`.
- Produces: `POST /auth/email-check` and `POST /auth/spaces/email-check` (JSON), body `{email}`, `@UseFilters(AuthJsonExceptionFilter)`, `EMAIL_REQUIRED`/`INVALID_EMAIL` on bad input.

- [ ] **Step 1: failing e2e** POST `/auth/email-check` `{email:"new@x.io"}` → 200 `{existing:false, status:"CREDENTIAL"}`; missing email → 400 `{error_code, error_message:"EMAIL_REQUIRED"}`.
- [ ] **Step 2: FAIL → Step 3: Implement** (thin controller; validate email present + shape else throw `AuthError`). → **Step 4: PASS → Step 5: Commit** `feat(nestjs-api): /auth/email-check (app+spaces)`.

---

### Task 10: sign-in / sign-up / sign-out — redirect parity (app)

**Files:**

- Modify: `apps/nestjs-api/src/modules/auth/credentials.controller.ts` (replace JSON sign-in/out with redirect; add sign-up)
- Test: `apps/nestjs-api/test/credentials.e2e.spec.ts` (replace the old JSON assertions)

**Interfaces:**

- Consumes: email provider, `sessions.create`, `setSessionCookie`/`clearSessionCookie`, `redirectSuccess`/`redirectError`, `getRedirectionPath`, `validateNextPath`, `CsrfGuard`.
- Produces: `POST /auth/sign-in`, `POST /auth/sign-up`, `POST /auth/sign-out` — form-POST (`@Body()` reads urlencoded `email`/`password`/`next_path`/`csrfmiddlewaretoken`), `@UseGuards(CsrfGuard)`, 302-redirect (success → `nextPath || getRedirectionPath(user)`; error → `redirectError`). Body parsing: ensure `express.urlencoded` is enabled in `main.ts` (add if missing).
- **Login persistence (`save_user_data`, from the Task 8 review):** on EVERY successful sign-in AND sign-up, before issuing the session, persist Django's `complete_login_or_signup`→`save_user_data` side-effects on the `users` row: set `is_active=true` (reactivates a never-logged-out inactive account), `last_active=now`, `last_login_time=now`, `last_login_ip`, `last_login_medium="email"`, `last_login_uagent`, `token_updated_at=now`. Add a small `recordLogin(db, userId, req)` helper (or method on the provider/session) — this is the write the Task 8 provider intentionally omits.

- [ ] **Step 1: failing e2e** — first `GET /auth/get-csrf-token` to grab cookie+token, then form-POST sign-up with a strong password + csrf → 302 whose `Location` starts with `APP_BASE_URL` and a `session-id` cookie is set; sign-in with a wrong password → 302 with `error_code`/`error_message=AUTHENTICATION_FAILED_SIGN_IN` (5065 — the Django-real code, NOT the generic AUTHENTICATION_FAILED; the frontend switches on it); a POST without the csrf token → 403. sign-out → clears the cookie (302). Add an assertion that a successful sign-in updates the user's `last_login_time` (proves `recordLogin` ran). (Seed/reset the test user in `beforeAll`.)
- [ ] **Step 2: run — verify the OLD JSON sign-in test now fails (behavior changed) and rewrite it → FAIL for the new expectations.**
- [ ] **Step 3: Implement** the three handlers (mirror `views/app/email.py` sign-in L26 / sign-up L135, `views/app/signout.py`). Enable `app.use(express.urlencoded({ extended: true }))` in `main.ts` if not present.
- [ ] **Step 4: PASS + `npx tsc --noEmit` → Step 5: Commit** `feat(nestjs-api): email sign-in/up/out redirect+CSRF parity (app)`.

---

### Task 11: spaces sign-in / sign-up / sign-out variants

**Files:**

- Create: `apps/nestjs-api/src/modules/auth/spaces/credentials-space.controller.ts`
- Test: `apps/nestjs-api/test/credentials-space.e2e.spec.ts`

**Interfaces:**

- Consumes: same email provider + helpers with `audience="space"`.
- Produces: `POST /auth/spaces/sign-in`, `/auth/spaces/sign-up`, `/auth/spaces/sign-out` — identical logic to Task 10 but redirect base via `baseHost(cfg,"space")` (`SPACE_BASE_URL`), CSRF-guarded.

- [ ] **Step 1: failing e2e smoke** — sign-up via `/auth/spaces/sign-up` (with csrf) → 302 whose `Location` starts with the space base URL + session cookie set.
- [ ] **Step 2: FAIL → Step 3: Implement** (thin controller delegating to the same provider, `audience="space"`). → **Step 4: PASS → Step 5: Commit** `feat(nestjs-api): email auth spaces variants`.

---

### Task 12: Module wiring + full verification

**Files:**

- Create: `apps/nestjs-api/src/modules/auth/auth.module.ts` (if not present) or Modify existing
- Modify: `apps/nestjs-api/src/app.module.ts` (register AuthModule + `ThrottlerModule.forRootAsync` using `parseRateLimit`), `apps/nestjs-api/src/main.ts` (urlencoded, confirm cookie-parser present)

**Interfaces:**

- Consumes: everything above.
- Produces: all `/auth/*` and `/auth/spaces/*` routes from Plan 1 mounted; the throttler applied to `/auth/*`.

- [ ] **Step 1** Wire `AuthModule` (providers: email provider, `CsrfService`, `SessionService` already global; controllers: csrf, email-check, credentials, spaces credentials) and register it + throttler in `app.module.ts`.
- [ ] **Step 2** `npx tsc --noEmit` (clean) and full `npm run test:e2e` — confirm all Plan-1 specs green and only the 3 known pre-existing Redis failures remain (state them by name); `npm run test:unit` 239+new all pass.
- [ ] **Step 3** Manual smoke against `plane_test`: `source "$SCRATCH/db-env.sh"; curl -s -c /tmp/cj -b /tmp/cj http://localhost:8000/auth/get-csrf-token` then a form-POST sign-up; confirm 302 + session cookie. (App must be running on :8000 with `DATABASE_URL=$TEST_DB_URL`.)
- [ ] **Step 4: Commit** `feat(nestjs-api): wire auth module + throttler; Plan 1 (infra+email/password) complete`.

---

## Self-Review

**Spec coverage (Plan 1 slice):** shared infra → Tasks 1–6; `workspace_member_invites` → Task 7; email-check → 9; sign-in/up/out redirect+CSRF → 10; spaces variants → 11; get-csrf-token → 5; rate-limit → 1/12; wiring → 12. **Deferred to later plans (from same spec):** magic link, password reset, OAuth ×4, the `accounts` table, and the spaces variants of those — explicitly out of Plan 1.

**Placeholder check:** transcription tasks (error-codes dict, redirect helpers, redirection-path) name the exact Django file:line to port and give the TS signature + a real failing test — these are port instructions with a concrete source, not TODOs.

**Type consistency:** `Audience` type shared (redirect.ts) across auth-response and controllers; provider methods `emailCheck`/`signUp`/`signIn` names match between Tasks 8/9/10/11; `AuthError.getErrorDict()`/`.status` consistent across Tasks 2/4/9/10.

**Known interdependency:** Task 6 (`getRedirectionPath`) needs Task 7's `workspace_member_invites` — execution order 7 before 6, or 6 reads the table added in 7. Reorder to 1→2→3→4→5→7→6→8→9→10→11→12 (schema before redirection-path).
