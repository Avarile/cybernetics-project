import { Body, Controller, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CsrfGuard } from "../../infra/auth/csrf.guard";
import { redirectError, redirectSuccess } from "../../infra/auth/auth-response";
import { getRedirectionPath } from "../../infra/auth/redirection-path";
import { validateNextPath } from "../../infra/auth/redirect";
import { AuthError } from "../../infra/auth/error-codes";
import { SessionService } from "../../infra/auth/session.service";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import type { User } from "../../infra/database/schema";
import { ConfigService } from "../../infra/config/config.service";
import { buildDeviceInfo, clearSessionCookie, sessionCookieName, setSessionCookie } from "./cookie.util";
import { recordLogin } from "./login.util";
import { EmailProvider } from "./email.provider";

interface CredentialsFormBody {
  email?: string;
  password?: string;
  next_path?: string;
  csrfmiddlewaretoken?: string;
}

/**
 * Email/password auth (plane/authentication email provider). Mounted at /auth.
 * Form-POST + 302-redirect protocol, mirroring Django's app views exactly:
 *   views/app/email.py::SignInAuthEndpoint / SignUpAuthEndpoint, views/app/signout.py.
 * CSRF double-submit guards all three -- pre-login JSON endpoints (email-check) skip it.
 */
@Controller("auth")
export class CredentialsController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly emailProvider: EmailProvider,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Post("sign-in")
  @UseGuards(CsrfGuard)
  async signIn(@Body() body: CredentialsFormBody, @Req() req: Request, @Res() res: Response): Promise<void> {
    const nextPath = body?.next_path;
    try {
      const user = await this.emailProvider.signIn(body?.email ?? "", body?.password ?? "");
      await this.completeLogin(user, req, res, nextPath);
    } catch (err) {
      this.failLogin(err, req, res, nextPath);
    }
  }

  @Post("sign-up")
  @UseGuards(CsrfGuard)
  async signUp(@Body() body: CredentialsFormBody, @Req() req: Request, @Res() res: Response): Promise<void> {
    const nextPath = body?.next_path;
    try {
      const user = await this.emailProvider.signUp(body?.email ?? "", body?.password ?? "");
      await this.completeLogin(user, req, res, nextPath);
    } catch (err) {
      this.failLogin(err, req, res, nextPath);
    }
  }

  @Post("sign-out")
  @UseGuards(CsrfGuard)
  async signOut(@Req() req: Request, @Res() res: Response): Promise<void> {
    const name = sessionCookieName(req);
    const key = req.cookies?.[name];
    if (key) await this.sessions.destroy(key);
    clearSessionCookie(res, name, this.config);
    redirectSuccess(this.config, res, req, "app", "");
  }

  /** save_user_data + login + redirection_path (adapter/base.py, utils/login.py, utils/redirection_path.py). */
  private async completeLogin(user: User, req: Request, res: Response, nextPath: string | undefined): Promise<void> {
    await recordLogin(this.db, user.id, req);
    const { key, maxAge } = await this.sessions.create(user, buildDeviceInfo(req), false);
    setSessionCookie(res, sessionCookieName(req), key, maxAge, this.config);
    const path = nextPath || (await getRedirectionPath(this.db, { id: user.id, email: user.email ?? "" }));
    redirectSuccess(this.config, res, req, "app", path);
  }

  private failLogin(err: unknown, req: Request, res: Response, nextPath: string | undefined): void {
    if (!(err instanceof AuthError)) throw err;
    redirectError(this.config, res, req, "app", err, validateNextPath(nextPath));
  }
}
