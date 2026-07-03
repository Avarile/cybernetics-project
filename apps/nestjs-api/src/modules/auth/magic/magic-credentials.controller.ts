import { Body, Controller, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CsrfGuard } from "../../../infra/auth/csrf.guard";
import { AuthError, AUTHENTICATION_ERROR_CODES } from "../../../infra/auth/error-codes";
import { DRIZZLE, type Database } from "../../../infra/database/drizzle.module";
import { ConfigService } from "../../../infra/config/config.service";
import { AuthService } from "../auth.service";
import { EmailProvider } from "../email.provider";
import { assertInstanceSetup } from "../instance-guard";
import { completeLogin, failLogin } from "../login-flow.util";
import { SessionService } from "../../../infra/auth/session.service";
import { MagicCodeService } from "./magic-code.service";

interface MagicCredentialsFormBody {
  email?: string;
  code?: string;
  next_path?: string;
  csrfmiddlewaretoken?: string;
}

/**
 * plane/authentication/views/app/magic.py::MagicSignInEndpoint (L64) / MagicSignUpEndpoint (L147).
 * Form-POST + 302-redirect protocol, mirroring credentials.controller.ts exactly -- see that file's
 * header. Mounted at /auth (app only; the space counterpart is a later task).
 *
 * Deliberate ordering deviation from Django: both endpoints here run `verify()` before the
 * user-exists branch, whereas Django runs its `existing_user` check first and only then constructs
 * the MagicCodeProvider. The two agree for every code path exercised by a real client (verify()
 * already discriminates its own error codes by user existence, same as Django's shared
 * set_user_data), and this keeps the code-matching logic in one place instead of duplicating the
 * user lookup ahead of it.
 */
@Controller("auth")
export class MagicCredentialsController {
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
      await this.magicCode.assertEnabled(email);

      if (!email || !code) {
        throw new AuthError({
          code: AUTHENTICATION_ERROR_CODES.MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED,
          message: "MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED",
          payload: { email },
        });
      }

      await this.magicCode.verify(`magic_${email}`, code);

      const user = await this.auth.findUserByEmail(email);
      if (!user) {
        throw new AuthError({
          code: AUTHENTICATION_ERROR_CODES.USER_DOES_NOT_EXIST,
          message: "USER_DOES_NOT_EXIST",
          payload: { email },
        });
      }

      await completeLogin(this.db, this.sessions, this.config, "app", user, req, res, nextPath);
    } catch (err) {
      failLogin(this.config, "app", err, req, res, nextPath);
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
      await this.magicCode.assertEnabled(email);

      if (!email || !code) {
        throw new AuthError({
          code: AUTHENTICATION_ERROR_CODES.MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED,
          message: "MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED",
          payload: { email },
        });
      }

      await this.magicCode.verify(`magic_${email}`, code);

      const existing = await this.auth.findUserByEmail(email);
      if (existing) {
        throw new AuthError({
          code: AUTHENTICATION_ERROR_CODES.USER_ALREADY_EXIST,
          message: "USER_ALREADY_EXIST",
          payload: { email },
        });
      }

      const user = await this.emailProvider.createMagicUser(email);
      await completeLogin(this.db, this.sessions, this.config, "app", user, req, res, nextPath);
    } catch (err) {
      failLogin(this.config, "app", err, req, res, nextPath);
    }
  }
}
