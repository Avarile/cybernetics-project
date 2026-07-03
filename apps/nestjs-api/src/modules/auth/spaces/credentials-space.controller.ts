import { Body, Controller, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CsrfGuard } from "../../../infra/auth/csrf.guard";
import { SessionService } from "../../../infra/auth/session.service";
import { DRIZZLE, type Database } from "../../../infra/database/drizzle.module";
import { ConfigService } from "../../../infra/config/config.service";
import { EmailProvider } from "../email.provider";
import { completeLogin, failLogin, signOutFlow } from "../login-flow.util";

interface CredentialsFormBody {
  email?: string;
  password?: string;
  next_path?: string;
  csrfmiddlewaretoken?: string;
}

/**
 * Space-audience variant of credentials.controller.ts -- identical email/password auth flow, only
 * the redirect target differs (audience="space" -> SPACE_BASE_URL). Mounted at /auth/spaces to
 * match Django's views/space/email.py / views/space/signout.py front-end path. All shared logic
 * (EmailProvider, recordLogin/recordLogout, session issuance, redirect safety) lives in
 * login-flow.util.ts -- this controller is a thin audience="space" wrapper around it.
 */
@Controller("auth/spaces")
export class CredentialsSpaceController {
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
      await completeLogin(this.db, this.sessions, this.config, "space", user, req, res, nextPath);
    } catch (err) {
      failLogin(this.config, "space", err, req, res, nextPath);
    }
  }

  @Post("sign-up")
  @UseGuards(CsrfGuard)
  async signUp(@Body() body: CredentialsFormBody, @Req() req: Request, @Res() res: Response): Promise<void> {
    const nextPath = body?.next_path;
    try {
      const user = await this.emailProvider.signUp(body?.email ?? "", body?.password ?? "");
      await completeLogin(this.db, this.sessions, this.config, "space", user, req, res, nextPath);
    } catch (err) {
      failLogin(this.config, "space", err, req, res, nextPath);
    }
  }

  @Post("sign-out")
  @UseGuards(CsrfGuard)
  async signOut(@Req() req: Request, @Res() res: Response): Promise<void> {
    await signOutFlow(this.db, this.sessions, this.config, "space", req, res);
  }
}
