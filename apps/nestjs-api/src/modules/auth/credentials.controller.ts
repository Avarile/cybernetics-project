import { Body, Controller, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CsrfGuard } from "../../infra/auth/csrf.guard";
import { SessionService } from "../../infra/auth/session.service";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { ConfigService } from "../../infra/config/config.service";
import { EmailProvider } from "./email.provider";
import { completeLogin, failLogin, signOutFlow } from "./login-flow.util";

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
 * Shared login/logout/redirect flow lives in login-flow.util.ts (audience="app") -- see
 * spaces/credentials-space.controller.ts for the audience="space" counterpart.
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
      await completeLogin(this.db, this.sessions, this.config, "app", user, req, res, nextPath);
    } catch (err) {
      failLogin(this.config, "app", err, req, res, nextPath);
    }
  }

  @Post("sign-up")
  @UseGuards(CsrfGuard)
  async signUp(@Body() body: CredentialsFormBody, @Req() req: Request, @Res() res: Response): Promise<void> {
    const nextPath = body?.next_path;
    try {
      const user = await this.emailProvider.signUp(body?.email ?? "", body?.password ?? "");
      await completeLogin(this.db, this.sessions, this.config, "app", user, req, res, nextPath);
    } catch (err) {
      failLogin(this.config, "app", err, req, res, nextPath);
    }
  }

  @Post("sign-out")
  @UseGuards(CsrfGuard)
  async signOut(@Req() req: Request, @Res() res: Response): Promise<void> {
    await signOutFlow(this.db, this.sessions, this.config, "app", req, res);
  }
}
