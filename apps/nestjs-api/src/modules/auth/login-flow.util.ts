import type { Request, Response } from "express";
import { redirectError, redirectSuccess } from "../../infra/auth/auth-response";
import { AuthError } from "../../infra/auth/error-codes";
import { validateNextPath, type Audience } from "../../infra/auth/redirect";
import { getRedirectionPath } from "../../infra/auth/redirection-path";
import type { SessionService } from "../../infra/auth/session.service";
import type { ConfigService } from "../../infra/config/config.service";
import type { Database } from "../../infra/database/drizzle.module";
import type { User } from "../../infra/database/schema";
import { buildDeviceInfo, clearSessionCookie, sessionCookieName, setSessionCookie } from "./cookie.util";
import { recordLogin, recordLogout } from "./login.util";

/**
 * Shared save_user_data + login/logout + redirection_path flow (adapter/base.py, utils/login.py,
 * utils/redirection_path.py), parameterized by audience so every sign-in surface (app, spaces, ...)
 * drives the exact same logic through a different redirect target. Extracted here so it isn't
 * copy-pasted per audience -- see credentials.controller.ts (app, audience="app") and
 * spaces/credentials-space.controller.ts (audience="space").
 */
export async function completeLogin(
  db: Database,
  sessions: SessionService,
  config: ConfigService,
  audience: Audience,
  user: User,
  req: Request,
  res: Response,
  nextPath: string | undefined,
): Promise<void> {
  await recordLogin(db, user.id, req);
  const { key, maxAge } = await sessions.create(user, buildDeviceInfo(req), false);
  setSessionCookie(res, sessionCookieName(req), key, maxAge, config);
  const path = validateNextPath(nextPath) || (await getRedirectionPath(db, { id: user.id, email: user.email ?? "" }));
  redirectSuccess(config, res, req, audience, path);
}

export function failLogin(
  config: ConfigService,
  audience: Audience,
  err: unknown,
  req: Request,
  res: Response,
  nextPath: string | undefined,
): void {
  if (!(err instanceof AuthError)) throw err;
  redirectError(config, res, req, audience, err, validateNextPath(nextPath));
}

/** views/app/signout.py::SignOutAuthEndpoint, parameterized by audience. */
export async function signOutFlow(
  db: Database,
  sessions: SessionService,
  config: ConfigService,
  audience: Audience,
  req: Request,
  res: Response,
): Promise<void> {
  const name = sessionCookieName(req);
  const key = req.cookies?.[name];
  if (key) {
    const resolved = await sessions.resolve(key);
    if (resolved) await recordLogout(db, resolved.user.id, req);
    await sessions.destroy(key);
  }
  clearSessionCookie(res, name, config);
  redirectSuccess(config, res, req, audience, "");
}
