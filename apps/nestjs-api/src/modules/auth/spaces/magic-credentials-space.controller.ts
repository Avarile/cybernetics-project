import { Body, Controller, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { CsrfGuard } from "../../../infra/auth/csrf.guard";
import { AuthError, AUTHENTICATION_ERROR_CODES } from "../../../infra/auth/error-codes";
import { DRIZZLE, type Database } from "../../../infra/database/drizzle.module";
import { profiles } from "../../../infra/database/schema";
import { ConfigService } from "../../../infra/config/config.service";
import { AuthService } from "../auth.service";
import { EmailProvider } from "../email.provider";
import { assertInstanceSetup } from "../instance-guard";
import { completeLogin, failLogin } from "../login-flow.util";
import { SessionService } from "../../../infra/auth/session.service";
import { MagicCodeService } from "../magic/magic-code.service";

interface MagicCredentialsFormBody {
  email?: string;
  code?: string;
  next_path?: string;
  csrfmiddlewaretoken?: string;
}

/**
 * Space-audience variant of magic-credentials.controller.ts -- identical magic-link sign-in/up
 * flow (check order, error codes, is_password_autoset+onboarded pathOverride), only the redirect
 * target differs (audience="space" -> SPACE_BASE_URL). Mounted at /auth/spaces to match Django's
 * views/space/magic.py front-end path. Mirrors credentials-space.controller.ts's convention of
 * being a thin audience="space" wrapper around the shared login-flow.util.ts logic.
 */
@Controller("auth/spaces")
export class MagicCredentialsSpaceController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly auth: AuthService,
    private readonly magicCode: MagicCodeService,
    private readonly emailProvider: EmailProvider,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Post("magic-sign-in")
  @UseGuards(CsrfGuard)
  async magicSignIn(@Body() body: MagicCredentialsFormBody, @Req() req: Request, @Res() res: Response): Promise<void> {
    const nextPath = body?.next_path;
    try {
      const email = (body?.email ?? "").trim().toLowerCase();
      const code = (body?.code ?? "").trim();

      await assertInstanceSetup(this.db);

      if (!email || !code) {
        throw new AuthError({
          code: AUTHENTICATION_ERROR_CODES.MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED,
          message: "MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED",
          payload: { email },
        });
      }

      const user = await this.auth.findUserByEmail(email);
      if (!user) {
        throw new AuthError({
          code: AUTHENTICATION_ERROR_CODES.USER_DOES_NOT_EXIST,
          message: "USER_DOES_NOT_EXIST",
          payload: { email },
        });
      }

      await this.magicCode.assertEnabled(email);
      await this.magicCode.verify(`magic_${email}`, code);

      // views/app/magic.py L120-128: an autoset-password user who has already onboarded goes home,
      // ignoring next_path entirely -- everyone else gets the normal next_path/redirection-path
      // behavior. A missing profile row is treated as not-onboarded (same convention as
      // redirection-path.ts, which doesn't create one as a side effect of a read).
      const [profile] = await this.db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);
      const pathOverride = user.isPasswordAutoset && profile?.isOnboarded ? "/" : undefined;

      await completeLogin(this.db, this.sessions, this.config, "space", user, req, res, nextPath, pathOverride);
    } catch (err) {
      failLogin(this.config, "space", err, req, res, nextPath);
    }
  }

  @Post("magic-sign-up")
  @UseGuards(CsrfGuard)
  async magicSignUp(@Body() body: MagicCredentialsFormBody, @Req() req: Request, @Res() res: Response): Promise<void> {
    const nextPath = body?.next_path;
    try {
      const email = (body?.email ?? "").trim().toLowerCase();
      const code = (body?.code ?? "").trim();

      await assertInstanceSetup(this.db);

      if (!email || !code) {
        throw new AuthError({
          code: AUTHENTICATION_ERROR_CODES.MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED,
          message: "MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED",
          payload: { email },
        });
      }

      const existing = await this.auth.findUserByEmail(email);
      if (existing) {
        throw new AuthError({
          code: AUTHENTICATION_ERROR_CODES.USER_ALREADY_EXIST,
          message: "USER_ALREADY_EXIST",
          payload: { email },
        });
      }

      await this.magicCode.assertEnabled(email);
      await this.magicCode.verify(`magic_${email}`, code);

      const user = await this.emailProvider.createMagicUser(email);
      await completeLogin(this.db, this.sessions, this.config, "space", user, req, res, nextPath);
    } catch (err) {
      failLogin(this.config, "space", err, req, res, nextPath);
    }
  }
}
