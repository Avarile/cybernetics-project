# NestJS Auth-Surface Port — Design

**Date:** 2026-07-04
**Status:** Approved (design) — pending spec review
**Component:** `apps/nestjs-api`

## Problem

Creating an account in the web app fails with `404 Cannot POST /auth/email-check/`. The NestJS API
(now the standalone backend the web app talks to via `VITE_API_BASE_URL`) only implements
`POST /auth/sign-in` and `POST /auth/sign-out` (as JSON) — the rest of Plane's authentication surface
was never ported. The frontend uses Django's exact protocol, so every unported endpoint 404s, and
because the email-first flow calls `email-check` **before** sign-in, it blocks login too.

## Decisions (agreed)

1. **One comprehensive spec** covering the entire auth surface in a single plan/implementation.
2. **Faithful Django protocol parity** — the web frontend is obfuscated (identifiers mangled to `n`)
   and cannot be safely modified, so NestJS mirrors Django's protocol exactly (form-POST + 302-redirect
   with error-code query params for the "View" family; JSON for the DRF "APIView" family; CSRF
   double-submit). The frontend stays untouched.
3. **App + spaces**: port both `/auth/*` and `/auth/spaces/*`.
4. **All four OAuth providers**: Google, GitHub, GitLab, Gitea.
5. Baked-in sub-decisions: (a) CSRF = self-consistent double-submit cookie (not Django-token-format-
   exact — safe because the frontend relays whatever token we issue); (b) password-reset token mirrors
   Django's `PasswordResetTokenGenerator` algorithm (HMAC over pk + password-hash + last_login + ts,
   salted with `SECRET_KEY`); (c) add `zxcvbn` npm dep for the strength gate; (d) OAuth avatar
   fetch→S3 is deferrable to a sub-step if heavy (create user without avatar rather than block OAuth).

## Reused (already Django-compatible — do NOT rebuild)

- `infra/auth/session.crypto.ts` + `session.service.ts` — Django `signing.dumps/loads`, session-auth
  hash, 128-char key; bidirectional (Django can decode NestJS sessions). Session issuance = `user_login`.
- `infra/auth/django-password.ts` — `verifyDjangoPassword` / `makeDjangoPassword` (pbkdf2_sha256/sha1).
- `modules/auth/cookie.util.ts` — path-based cookie name (`session-id` vs `admin-session-id`), attrs.
- `infra/mailer/mailer.service.ts` — nodemailer via `InstanceConfigService` email config.
- `infra/storage/s3.service.ts` — S3/MinIO presigned upload/download (for avatars).
- `infra/config/instance-config.service.ts` — DB-vs-env config precedence + Fernet decrypt (the auth
  config gates).
- `modules/instance/admin-seed.service.ts` — the exact user+profile creation pattern (reuse for sign-up).

## Scope

**In:** all `/auth/*` and `/auth/spaces/*` endpoints (email-check, sign-in, sign-up, sign-out,
get-csrf-token, magic-generate/sign-in/sign-up, forgot-password, reset-password, change-password,
set-password, OAuth initiate+callback for google/github/gitlab/gitea), plus the shared redirect/CSRF/
error-code/rate-limit infra and the `accounts` + `workspace_member_invites` schema additions.

**Out (non-goals):** admin/god-mode auth endpoints (separate surface); changing the obfuscated
frontend; deactivated-account/import flows beyond what Django's `complete_login_or_signup` does.

## Architecture — module layout

```
src/modules/auth/
  email/        email-check, sign-in, sign-up controllers + email.provider
  magic/        magic-generate/sign-in/sign-up controller + magic-code.provider (Redis)
  password/     forgot/reset/change/set-password controller + reset-token.ts
  oauth/        oauth.adapter (base) + {google,github,gitlab,gitea}.provider + controllers
  spaces/       thin space-variant controllers reusing the providers (audience="space")
  csrf/         get-csrf-token controller
src/infra/auth/            (existing session.* + django-password + NEW:)
  redirect.ts              baseHost / validateNextPath / getSafeRedirectUrl / getAllowedHosts
  error-codes.ts           AUTHENTICATION_ERROR_CODES + AuthError.getErrorDict()
  auth-exception.filter.ts maps AuthError -> redirect (View family) or JSON (APIView family)
  csrf.guard.ts + csrf.service.ts
  redirection-path.ts      getRedirectionPath(user) -> onboarding|<slug>|invitations|create-workspace
  auth-throttle.ts         @nestjs/throttler wiring (10/min)
```

Each provider is audience-agnostic (app|space); controllers are thin and set the redirect base via
`baseHost(req, audience)`.

## Shared infra (Django refs)

- **Redirect safety** — mirror `plane/utils/path_validator.py` (`validate_next_path` L105,
  `get_safe_redirect_url` L137-181) and `authentication/utils/host.py` (`base_host` L16-63). Build
  `${base}/?next_path=<validated>&<urlencoded params>`, guard with an allowed-hosts check
  (netlocs of WEB_URL/APP_BASE_URL/ADMIN_BASE_URL/SPACE_BASE_URL); fall back to `base+params` if the
  built URL isn't allowed. Success = no error params (just `next_path` or `getRedirectionPath`).
- **Error codes** — mirror `authentication/adapter/error.py` (codes 5000–5999). `AuthError` →
  `{error_code, error_message, ...payload}`.
- **CSRF** — `GET /auth/get-csrf-token` returns `{csrf_token}` and sets a `csrftoken` cookie
  (mirror `views/common.py:28`). `CsrfGuard` validates `csrfmiddlewaretoken` (form field) or
  `X-CSRFToken` header equals the cookie value, on the form-POST endpoints only. Cookie attrs from
  `CSRF_COOKIE_*` config.
- **Session/login** — reuse `sessions.create` + `setSessionCookie`; `getRedirectionPath` mirrors
  `authentication/utils/redirection_path.py:8-46`.
- **Rate limit** — `@nestjs/throttler`, `AUTHENTICATION_RATE_LIMIT` default `10/minute`
  (mirror `authentication/rate_limit.py:23`), applied to `/auth/*`.

## Schema additions (new migrations)

- **`accounts`** (OAuth token storage; Django `db.models.Account`) — Drizzle schema reconciled to the
  reference `plane` DB columns + migration.
- **`workspace_member_invites`** — Drizzle schema + migration (signup invite gate + redirection).

Both follow the standalone conventions from the DB-bootstrap work (baseColumns with `created_by`/
`updated_by`, parity-check divergence rules; see the bootstrap spec).

## Endpoints (protocol per family)

**JSON (DRF APIView) — return/throw the error dict with HTTP status:**
| Endpoint | Body → Response |
|----------|-----------------|
| `GET /auth/get-csrf-token` | → `{csrf_token}` (+ cookie) |
| `POST /auth/email-check` | `{email}` → `{existing:bool, status:"MAGIC_CODE"|"CREDENTIAL"}` (mirror `views/app/check.py:29`; status=MAGIC_CODE when magic enabled + SMTP configured + (new user or `is_password_autoset`)). Errors: INSTANCE_NOT_CONFIGURED / EMAIL_REQUIRED / INVALID_EMAIL (400). |
| `POST /auth/magic-generate` | `{email}` → 200; Redis code + email. Errors: SMTP_NOT_CONFIGURED, MAGIC_LINK_LOGIN_DISABLED, attempt-exhausted. |
| `POST /auth/forgot-password` | `{email}` → 200; email reset link. |
| `POST /auth/change-password` | session-required; `{old_password,new_password}`; zxcvbn. |
| `POST /auth/set-password` | session-required (autoset users); `{password}`; zxcvbn. |

**Form-POST → 302 redirect (Django View) — success redirects to `next_path`/`getRedirectionPath`; error redirects with `error_code`/`error_message` query params; CSRF-protected:**
`sign-in`, `sign-up`, `sign-out`, `magic-sign-in`, `magic-sign-up`,
`reset-password/<uidb64>/<token>`, and all OAuth `GET /auth/<provider>` + `/auth/<provider>/callback`.

Behavior sources: `views/app/email.py` (sign-in L26 / sign-up L135), `views/app/magic.py`
(L36/64/147), `views/app/password_management.py`, `views/app/google.py` (initiate/callback pattern),
GitHub org check, `adapter/base.py:309-395` `complete_login_or_signup` (user lookup/create, Profile,
Account upsert, deactivated rejection, avatar).

**Config gates:** ENABLE_EMAIL_PASSWORD (`provider/credentials/email.py:27`), ENABLE_SIGNUP
(`adapter/base.py:106`), ENABLE_MAGIC_LINK_LOGIN + EMAIL_HOST (`provider/credentials/magic_code.py`),
provider client-id/secret (`provider/oauth/*`).

## Magic-code state machine (Redis)

Mirror `provider/credentials/magic_code.py`: `magic_<email>` key = `{current_attempt,email,token}`,
TTL 600s, max 3 generate attempts; verify via a separate `<key>:verify_attempts` counter incremented
by an atomic Lua `INCR`+`EXPIRE`, capped at 5, token invalidated on cap/success. Uses the existing
`REDIS` provider (ioredis). Email via `MailerService` + a ported `magic_signin.html` template.

## OAuth (per provider)

Base `OauthAdapter` (mirror `adapter/oauth.py:24-136`): `authorize` (state=uuid in session,
redirect to IdP) → `callback` (verify `state` against session, exchange code, fetch userinfo) →
`complete_login_or_signup` (find/create user + Profile, `accounts` upsert with tokens, deactivated
rejection, avatar fetch→S3). Providers: Google, GitHub (+ `GITHUB_ORGANIZATION_ID` membership check
→ GITHUB_USER_NOT_IN_ORG), GitLab, Gitea (`GITEA_HOST`). Each raises `<PROVIDER>_NOT_CONFIGURED` when
client-id/secret unset.

## Password reset token

Mirror Django `PasswordResetTokenGenerator`: `uidb64 = base64(user.id)`; token = HMAC keyed on
`SECRET_KEY` over `pk + password_hash + last_login + timestamp`, with the default max-age window.
Validated in `reset-password`.

## Spaces variants

Every endpoint above has a `/auth/spaces/<path>` twin using `audience="space"` → `SPACE_BASE_URL`
(fallback `WEB_URL` + `SPACE_BASE_PATH`) as the redirect base and space cookie semantics. Thin
controllers reuse the same providers/services; no logic duplication.

## Error handling

`AuthError` thrown anywhere is caught by `auth-exception.filter.ts`: for redirect-family routes →
`res.redirect(getSafeRedirectUrl(baseHost(req,audience), nextPath, errorDict))`; for JSON-family →
`res.status(code).json(errorDict)`. Rate-limit exceed → `RATE_LIMIT_EXCEEDED` (429 JSON, or redirect
param for form routes). Instance-not-configured / setup-not-done checks precede each flow (mirror the
`instance is None or not instance.is_setup_done` guard in every Django auth view).

## Testing

- **Unit:** redirect-safety (open-redirect + `..`/scheme/netloc rejection); CSRF double-submit
  (accept match, reject missing/mismatch); error-code dict mapping; zxcvbn gate (<3 rejected);
  reset-token generate→validate round-trip + tamper/expiry rejection; magic Redis state machine
  (gen-attempt cap 3, verify cap 5) against a Redis test instance.
- **e2e (plane_test + Redis):** email-check both branches + shapes; sign-up → user+profile row +
  session cookie + 302 to redirection path; sign-in wrong-password → 302 with `error_code`;
  sign-out clears cookie; magic generate→sign-in end-to-end; forgot→reset end-to-end; get-csrf-token
  sets cookie and a form-POST without the token is rejected; OAuth callback with a mocked IdP creates
  user + `accounts` row + redirects. Space variants: at least one smoke per family against
  `SPACE_BASE_URL`.

## Dependencies / risks

- **Redis** must be reachable for magic-code (dev/tests: port-forward). **SMTP** (`EMAIL_HOST`) for
  magic/reset emails. **OAuth**: client id/secret per provider + the new `accounts` table; avatar
  needs S3 (present) — deferrable per decision (d).
- **New deps:** `@nestjs/throttler`, `zxcvbn`.
- **New tables:** `accounts`, `workspace_member_invites` (+ migrations, parity-checked).
- **Behavior change:** existing `sign-in`/`sign-out` flip JSON → redirect (corrects them to the
  frontend's actual contract).
- **CSRF during cutover:** tokens are NestJS-issued/validated only (not cross-valid with Django) —
  fine for standalone; note if Django and NestJS ever co-serve `/auth`.

## Files (high level)

- Add: `infra/auth/{redirect,error-codes,auth-exception.filter,csrf.guard,csrf.service,redirection-path,auth-throttle}.ts`.
- Add: `modules/auth/{email,magic,password,oauth,spaces,csrf}/…` controllers + providers.
- Add: `modules/auth/schema/{accounts,workspace-member-invites}.schema.ts` + generated migration.
- Add: auth email templates (`magic_signin`, `forgot_password`).
- Modify: `credentials.controller.ts` (sign-in/out → redirect), `app.module.ts` (wire modules,
  throttler), `package.json` (`@nestjs/throttler`, `zxcvbn`), `instance-config.seed.ts` (confirm gates).
- Tests: unit + e2e per the Testing section.
