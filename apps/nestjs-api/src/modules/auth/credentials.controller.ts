import { Body, Controller, HttpCode, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { SessionService } from "../../infra/auth/session.service";
import { serializeUser } from "../user/user.serializer";
import { AuthService } from "./auth.service";
import { buildDeviceInfo, clearSessionCookie, sessionCookieName, setSessionCookie } from "./cookie.util";
import { SignInDto } from "./dto/sign-in.dto";

/**
 * Email/password auth (plane/authentication email provider). Mounted at /auth.
 * NOTE: Django's endpoints 302-redirect with error codes; this returns JSON. Exact redirect parity
 * is a pre-cutover refinement (see 03-auth-and-rbac.md §6). Magic/OAuth/password-reset: follow-up.
 */
@Controller("auth")
export class CredentialsController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Post("sign-in")
  @HttpCode(200)
  async signIn(@Body() dto: SignInDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.verifyCredentials(dto.email, dto.password);
    if (!user) throw new UnauthorizedException({ error: "Invalid email or password" });

    const isAdmin = req.path.includes("instances");
    const { key, maxAge } = await this.sessions.create(user, buildDeviceInfo(req), isAdmin);
    setSessionCookie(res, sessionCookieName(req), key, maxAge, this.config);
    return serializeUser(user);
  }

  @Post("sign-out")
  @HttpCode(200)
  async signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const name = sessionCookieName(req);
    const key = req.cookies?.[name];
    if (key) await this.sessions.destroy(key);
    clearSessionCookie(res, name, this.config);
    return { status: "ok" };
  }
}
