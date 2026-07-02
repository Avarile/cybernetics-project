# 03 — Authentication, Sessions & RBAC

The compatibility-critical layer. Reproduces Django's dual-cookie sessions (drop-in, no re-login), API-key
auth + throttle, both authorization systems (DRF permission classes **and** the `@allow_permission`
decorator), and all `/auth` + `/api/instances` auth endpoints.

## 0. THE #1 RISK, RESOLVED: session cookie drop-in is achievable

Traced through `plane/db/models/session.py`, `plane/authentication/middleware/session.py`, and
`plane/authentication/session.py`. **Verdict: full drop-in session compatibility with no forced re-login.**

`SESSION_ENGINE = "plane.db.models.session"`; its `SessionStore` subclasses Django's **DB** backend. For the
DB backend the **cookie value is the raw `session_key`** — not signed, not the payload:

- `middleware/session.py:83` sets the cookie to `request.session.session_key`.
- `process_request` reads the cookie and does `SessionStore(session_key)` — a PK lookup.
- `_get_new_session_key` = `get_random_string(128, ascii_lowercase + digits)` → the cookie is a **128-char
  `[a-z0-9]` string, unsigned**.

Only the `session_data` **column** is signed. Better still, the custom `Session` model **denormalizes
`user_id`** (`create_model_instance` copies `_auth_user_id`). So the **read path needs no `SECRET_KEY`**:
cookie → row → `user_id` → user.

### `sessions` table
| column | type | notes |
|---|---|---|
| `session_key` | `varchar(128)` PK | = cookie value, `[a-z0-9]`, unsigned |
| `session_data` | `text` NOT NULL | Django-signed blob (needed only for *writes* / hash parity) |
| `expire_date` | `timestamptz`, indexed | authoritative expiry |
| `device_info` | `jsonb` null | `{user_agent, ip_address, domain}` |
| `user_id` | `varchar(50)`, indexed | denormalized dashed-UUID string |

### `session_data` payload (needed only for **writing** + optional hash parity)
Populated by Django `login()`:
- `_auth_user_id` = `str(user.id)` (dashed UUID)
- `_auth_user_backend` = `"django.contrib.auth.backends.ModelBackend"`
- `_auth_user_hash` = `salted_hmac("django.contrib.auth.models.AbstractBaseUser.get_session_auth_hash", user.password, algorithm="sha256").hexdigest()`
- `device_info` = `{user_agent, ip_address, domain}`

Encoding (Django 4.2) = `signing.dumps(dict, salt="django.contrib.sessions.SessionBase",
serializer=JSONSerializer, compress=True)`: JSON → optional zlib (prefix `.`) → urlsafe-b64 (no pad) →
`:base62(ts)` → `:urlsafe-b64(HMAC-SHA256)` with key `sha256(b"django.contrib.sessions.SessionBasesigner" + SECRET_KEY)`.
`expire_date` = now + `SESSION_COOKIE_AGE` (604800s) or `ADMIN_SESSION_COOKIE_AGE` (3600s) for admin.

### Consequence
- **Read** existing Django sessions: trivial (denormalized `user_id`, no crypto).
- **Write** new sessions bidirectionally: replicate Django signing exactly → **NestJS must run with the
  identical `SECRET_KEY`**. Since `session_data` is NOT NULL we must write a valid blob anyway; writing the
  Django-exact blob costs nothing extra and lets Django read NestJS-created sessions (safe rollback / mixed deploy).
- **Fallback if `SECRET_KEY` cannot be shared** (flagged): NestJS still *reads* existing sessions and *writes*
  functional ones in its own format, but Django can no longer decode NestJS-created sessions and
  `_auth_user_hash` password-invalidation parity breaks. This is a *soft* degradation, **not** a re-login.
  **Primary recommendation: share `SECRET_KEY`.**

## 1. Session auth — `SessionService` + `SessionGuard`

Django-exact signing (needed only for writes):

```ts
// infra/auth/session.crypto.ts
import { createHash, createHmac, randomBytes } from 'crypto';
import { deflateSync, inflateSync } from 'zlib';

const SALT = 'django.contrib.sessions.SessionBase';
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const b64u = (b: Buffer) => b.toString('base64url');
const derive = (salt: string, secret: string) =>
  createHash('sha256').update(Buffer.concat([Buffer.from(salt), Buffer.from(secret)])).digest();
const base62 = (n: number) => { if (!n) return '0'; let s=''; while (n>0){ s=B62[n%62]+s; n=Math.floor(n/62);} return s; };

export function djangoDumps(obj: unknown, secret: string, nowSec: number): string {
  const json = Buffer.from(JSON.stringify(obj));
  const comp = deflateSync(json);
  const payload = comp.length < json.length - 1 ? '.' + b64u(comp) : b64u(json);
  const withTs = `${payload}:${base62(nowSec)}`;
  const sig = b64u(createHmac('sha256', derive(SALT + 'signer', secret)).update(withTs).digest());
  return `${withTs}:${sig}`;
}
export function djangoLoads(signed: string, secret: string): any {
  const i = signed.lastIndexOf(':'); const value = signed.slice(0, i);
  const expected = b64u(createHmac('sha256', derive(SALT + 'signer', secret)).update(value).digest());
  if (expected !== signed.slice(i + 1)) throw new Error('bad signature');
  let b64 = value.slice(0, value.lastIndexOf(':')); const compressed = b64.startsWith('.');
  if (compressed) b64 = b64.slice(1);
  const raw = Buffer.from(b64, 'base64url');
  return JSON.parse((compressed ? inflateSync(raw) : raw).toString());
}
export function sessionAuthHash(password: string, secret: string): string {
  const key = derive('django.contrib.auth.models.AbstractBaseUser.get_session_auth_hash', secret);
  return createHmac('sha256', key).update(password).digest('hex');
}
export function newSessionKey(): string {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; const buf = randomBytes(128);
  let s=''; for (let i=0;i<128;i++) s += c[buf[i] % 36]; return s;
}
```

```ts
// infra/auth/session.service.ts
@Injectable()
export class SessionService {
  constructor(@Inject(DRIZZLE) private db, private cfg: ConfigService) {}
  async resolve(sessionKey: string) {
    const [row] = await this.db.select().from(sessions)
      .where(and(eq(sessions.sessionKey, sessionKey), gt(sessions.expireDate, new Date())));
    if (!row?.userId) return null;
    const [user] = await this.db.select().from(users).where(and(eq(users.id, row.userId), eq(users.isActive, true)));
    if (!user) return null;
    // OPTIONAL password-change parity (requires SECRET_KEY):
    // if (djangoLoads(row.sessionData, secret)._auth_user_hash !== sessionAuthHash(user.password, secret)) return null;
    return { user, session: row };
  }
  async create(user, deviceInfo: object, isAdmin: boolean) {
    const secret = this.cfg.getOrThrow('SECRET_KEY');
    const key = newSessionKey();
    const maxAge = isAdmin ? this.cfg.get('ADMIN_SESSION_COOKIE_AGE', 3600) : this.cfg.get('SESSION_COOKIE_AGE', 604800);
    const data = { _auth_user_id: String(user.id),
      _auth_user_backend: 'django.contrib.auth.backends.ModelBackend',
      _auth_user_hash: sessionAuthHash(user.password, secret), device_info: deviceInfo };
    await this.db.insert(sessions).values({ sessionKey: key, sessionData: djangoDumps(data, secret, Math.floor(Date.now()/1000)),
      userId: String(user.id), deviceInfo, expireDate: new Date(Date.now() + maxAge*1000) });
    return { key, maxAge };
  }
  destroy(sessionKey: string) { return this.db.delete(sessions).where(eq(sessions.sessionKey, sessionKey)); }
}
```

```ts
// infra/auth/session.guard.ts
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private sessions: SessionService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const cookieName = req.path.includes('instances') ? 'admin-session-id' : 'session-id';   // path-based, matches middleware
    const key = req.cookies?.[cookieName];
    if (!key) throw new UnauthorizedException({ detail: 'Authentication credentials were not provided.' });
    const resolved = await this.sessions.resolve(key);
    if (!resolved) throw new UnauthorizedException({ detail: 'Invalid session' });
    req.user = resolved.user; req.sessionRow = resolved.session;
    return true;
  }
}
```

Cookie write attributes must match `process_response` exactly: `httpOnly`, `secure` (from `secure_origins`),
`sameSite` (`SESSION_COOKIE_SAMESITE`), `domain` (`SESSION_COOKIE_DOMAIN`), `path: '/'`, `maxAge`. App and
space layers **share `session-id`**; only `/api/instances/*` uses `admin-session-id` (1h).
`SESSION_SAVE_EVERY_REQUEST` defaults off → **do not rotate on read** (matches Django); write only on login.
Use `cookie-parser`; do **not** use `express-session`.

## 2. API-key auth — `ApiKeyGuard` + `ApiKeyThrottleInterceptor`

Replicates `APIKeyAuthentication` (`X-Api-Key`, active/unexpired, `user.is_active`, `last_used` bump):

```ts
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(DRIZZLE) private db) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const token = req.headers['x-api-key'];
    if (!token) throw new UnauthorizedException('Given API token is not valid');
    const [row] = await this.db.select().from(apiTokens).innerJoin(users, eq(users.id, apiTokens.userId))
      .where(and(eq(apiTokens.token, token), eq(apiTokens.isActive, true), eq(users.isActive, true),
                 or(isNull(apiTokens.expiredAt), gt(apiTokens.expiredAt, new Date()))));
    if (!row) throw new UnauthorizedException('Given API token is not valid');
    await this.db.update(apiTokens).set({ lastUsed: new Date() }).where(eq(apiTokens.id, row.api_tokens.id));
    req.user = row.users; req.apiToken = row.api_tokens;
    return true;
  }
}
```

Throttle (Redis-backed, matches DRF `SimpleRateThrottle`; rate from `API_KEY_RATE_LIMIT` default `"60/minute"`,
scope `api_key`, key `api_key:<X-Api-Key>`, `X-RateLimit-*` headers). The DRF cache-key prefix is
`throttle_<scope>:<ident>` — matching it keeps counters unified if Django + NestJS share Redis.

```ts
@Injectable()
export class ApiKeyThrottleInterceptor implements NestInterceptor {
  private num: number; private durSec: number;
  constructor(private redis: Redis, cfg: ConfigService) {
    const [n, period] = cfg.get('API_KEY_RATE_LIMIT', '60/minute').split('/');
    this.num = +n;
    this.durSec = { s:1, sec:1, m:60, min:60, h:3600, hour:3600, d:86400, day:86400 }[period.slice(0,3)] ?? 60;
  }
  async intercept(ctx, next) {
    const req = ctx.switchToHttp().getRequest(), res = ctx.switchToHttp().getResponse();
    const apiKey = req.headers['x-api-key']; if (!apiKey) return next.handle();       // no key → allow (DRF parity)
    const cacheKey = `throttle_api_key:api_key:${apiKey}`; const now = Date.now()/1000;
    await this.redis.lpush(cacheKey, now); await this.redis.expire(cacheKey, this.durSec);
    const hist = (await this.redis.lrange(cacheKey, 0, -1)).map(Number).filter(t => t > now - this.durSec);
    if (hist.length > this.num) throw new HttpException({ error_code: 5900, error_message: 'RATE_LIMIT_EXCEEDED' }, 429);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, this.num - hist.length));
    res.setHeader('X-RateLimit-Reset', Math.floor(now + this.durSec));
    return next.handle();
  }
}
```

There is also an `AnchorGuard` for the public `space` surface (resolve a `DeployBoard` anchor → project/workspace
context, no user), used by anonymous published routes (see [`04`](./04-api-surface.md) §1).

## 3. Authorization / RBAC

Two systems coexist in Django and **both** must be reproduced:
- **DRF `permission_classes`** (e.g. `ProjectEntityPermission`, `WorkSpaceAdminPermission`) — method-aware
  (SAFE vs POST vs write), reading `view.workspace_slug` / `view.project_id`.
- **`@allow_permission(allowed_roles, level, creator, model)`** decorator — per-handler role gate with the
  workspace-admin-in-project override and the creator bypass.

Roles: `ADMIN=20, MEMBER=15, GUEST=5`.

```ts
export enum ROLE { ADMIN = 20, MEMBER = 15, GUEST = 5 }
interface RoleOpts { roles: ROLE[]; level?: 'PROJECT' | 'WORKSPACE'; creator?: boolean; model?: string; }
export const Roles = (o: RoleOpts) => SetMetadata('rbac', { level: 'PROJECT', ...o });
```

```ts
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private reflector: Reflector, private members: MemberService) {}
  async canActivate(ctx: ExecutionContext) {
    const meta = this.reflector.get<RoleOpts>('rbac', ctx.getHandler());
    if (!meta) return true;
    const req = ctx.switchToHttp().getRequest(); const { user } = req;
    const slug = req.params.slug;
    const projectId = req.params.project_id ?? req.params.pk;   // BaseAPIView.project_id fallback
    if (meta.creator && meta.model) {                           // allow_permission(creator=True, model=…)
      if (!(await this.members.isWorkspaceMember(slug, user.id))) throw this.forbidden();
      if (await this.members.isCreator(meta.model, req.params.pk, user.id)) return true;
    }
    if (meta.level === 'WORKSPACE') {
      if (await this.members.hasWorkspaceRole(slug, user.id, meta.roles)) return true;
    } else {
      if (await this.members.hasProjectRole(slug, projectId, user.id, meta.roles)) return true;
      if (await this.members.isProjectMember(slug, projectId, user.id)             // workspace-admin-in-project override
          && await this.members.hasWorkspaceRole(slug, user.id, [ROLE.ADMIN])) return true;
    }
    throw this.forbidden();
  }
  private forbidden() { return new ForbiddenException({ error: "You don't have the required permissions." }); }
}
```

`MemberService` methods are direct Drizzle translations of the Django querysets (all include `is_active = true`):

```ts
hasProjectRole(slug, projectId, userId, roles: ROLE[]) {
  return this.db.select({ x: sql`1` }).from(projectMembers)
    .innerJoin(workspaces, eq(workspaces.id, projectMembers.workspaceId))
    .where(and(eq(workspaces.slug, slug), eq(projectMembers.projectId, projectId),
               eq(projectMembers.memberId, userId), inArray(projectMembers.role, roles),
               eq(projectMembers.isActive, true))).limit(1).then(r => r.length > 0);
}
```

For the class-style DRF permissions, provide method-aware guards mapping 1:1 to `project.py`/`workspace.py`:
- `WorkspaceEntityGuard` — SAFE → any active workspace member; unsafe → role ∈ `[ADMIN, MEMBER]`.
- `ProjectEntityGuard` — SAFE → active project member; POST → workspace `[ADMIN, MEMBER]`; else project `[ADMIN, MEMBER]`.
- `ProjectBaseGuard` — adds the workspace-admin-in-project override on writes.
- `WorkSpaceAdminGuard`, `WorkspaceOwnerGuard`, `ProjectAdminGuard`, `ProjectLiteGuard`, `ProjectPageGuard`, etc.

`workspace_slug` = `req.params.slug`; `project_id` = `req.params.project_id` (fallback `req.params.pk` on the
project-detail route). Anonymous is already handled — the auth guard 401s before RBAC runs.

**Guard order per route:** `[SessionGuard | ApiKeyGuard]` → class permission guard and/or `RbacGuard`.

## 4. Auth endpoints (`/auth`) and instance admin (`/api/instances`)

These are **plain endpoints** (not session-guarded); they *create* the session and mostly **302-redirect**
with success/error query params (via the `AuthenticationException` error-code system). Reproduce that
redirect + error-code behavior. Every provider has parallel `spaces/` variants (same logic, `is_space`
affecting only the redirect host; **same `session-id` cookie**).

**`AuthModule`** (mounted at `/auth`):
- `AuthCredentialsController` — `POST sign-in`, `POST sign-up` (+ `spaces/*`); email+password, `zxcvbn`
  strength ≥3 on signup.
- `AuthMagicController` — `POST magic-generate` (Redis `magic_<email>`, 6-digit, 600s TTL, generate+verify
  attempt caps via atomic Lua INCR, `MAX_VERIFY_ATTEMPTS=5`), `POST magic-sign-in`, `POST magic-sign-up` (+ `spaces/*`).
- `AuthOAuthController` — per `google|github|gitlab|gitea`: `GET <provider>/` (initiate → redirect),
  `GET <provider>/callback/` (token exchange → userinfo → `complete_login_or_signup` → upsert `Account`),
  SSRF-safe avatar download, IdP sync flags (+ `spaces/*`).
- `AuthPasswordController` — `POST forgot-password`, `POST reset-password/:uidb64/:token`, `POST change-password`,
  `POST set-password` (+ `spaces/*`). Token = Django `PasswordResetTokenGenerator` (HMAC over
  pk+timestamp+password-hash+last_login, `PASSWORD_RESET_TIMEOUT=3600`) — reproduce exactly if existing
  reset links must stay valid.
- `AuthSignoutController` — `POST sign-out` (+ `spaces/*`): set `last_logout_time`/`last_logout_ip`, delete
  session row, clear cookie, redirect.
- `AuthCsrfController` — `GET get-csrf-token`. **CSRF is disabled for the REST APIs**
  (`BaseSessionAuthentication.enforce_csrf` no-ops), so this endpoint just returns a token-shaped payload the
  frontend expects; guards do not enforce CSRF.
- `AuthEmailCheckController` — `POST email-check` (+ `spaces/*`).

Shared building block: `AuthAdapterService` = the `Adapter.complete_login_or_signup` pipeline (sanitize email,
find/create `User` + `Profile`, signup-enabled + invite check via `ENABLE_SIGNUP`, deactivated-account
rejection, `save_user_data`) → `SessionService.create()` + `user_login` equivalent (build `device_info`,
`isAdmin` sets the 3600s expiry). Gate flags reproduced: `ENABLE_EMAIL_PASSWORD`, `ENABLE_MAGIC_LINK_LOGIN`,
`ENABLE_SIGNUP`, per-provider `ENABLE_*_SYNC`.

**`InstanceModule`** (mounted at `/api/instances`, **admin cookie**): `POST admins/sign-in|sign-up|sign-out`,
`GET admins/me`, `GET/POST admins/session`, admin CRUD, `configurations/` (get/set global config incl. AI
keys), `configurations/disable-email-feature/`, `email-credentials-check/`, `admins/sign-up-screen-visited/`,
`workspace-slug-check/`, `workspaces/`, `GET ""` (instance). Because the path contains `instances`,
`SessionGuard` auto-selects `admin-session-id`; sign-in calls `SessionService.create(..., isAdmin=true)`.
The instance-admin **role/permission gate** mirrors `license/api/permissions/instance.py`.

## 5. Throttling, CORS & error envelope

**Global throttles (DRF defaults):** `anon = 30/minute` (IP-keyed), `asset_id = 5/minute` (asset-id-keyed) —
same Redis pattern as §2, cache-key namespaces `throttle_anon:<ip>` / `throttle_asset_id:<id>`.

**CORS** (from `common.py`): `credentials: true`; `CORS_ALLOWED_ORIGINS` allowlist or reflect-all fallback;
**allowed headers must include `X-API-Key`**. `secure_origins` (true unless any origin is `http:`) drives
`SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE`. (Full CORS/error-filter detail in [`04`](./04-api-surface.md) §4.)

## 6. Fidelity checklist

- [ ] A **Django-issued** `session-id` cookie authenticates on NestJS (read path, no `SECRET_KEY`).
- [ ] A **NestJS-issued** session is decodable by Django (`djangoDumps` byte-parity, shared `SECRET_KEY`).
- [ ] `admin-session-id` selected only on `/api/instances/*`, with 1-hour expiry.
- [ ] Invalid/expired/inactive-user sessions → 401 `{"detail": …}`.
- [ ] API key: inactive/expired/missing → 401 `Given API token is not valid`; `last_used` updated; over-limit → 429 `{error_code:5900}` with `X-RateLimit-*` headers.
- [ ] RBAC: role gate + workspace-admin-in-project override + creator bypass match Django on representative endpoints.
- [ ] Magic OTP: attempt caps + TTL match; OAuth callback upserts `Account` and creates a session.
