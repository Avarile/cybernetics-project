import { randomUUID } from "crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import zxcvbn from "zxcvbn";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { users, profiles, workspaceMemberInvites, type User } from "../../infra/database/schema";
import { InstanceConfigService } from "../../infra/config/instance-config.service";
import { makeDjangoPassword, verifyDjangoPassword } from "../../infra/auth/django-password";
import { AuthError, AUTHENTICATION_ERROR_CODES } from "../../infra/auth/error-codes";
import { AuthService } from "./auth.service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email/password auth business logic. Collapses three Django files into one class:
 *  - plane/authentication/views/app/check.py::EmailCheckEndpoint    -> emailCheck
 *  - plane/authentication/views/app/email.py::SignUpAuthEndpoint    -> signUp
 *    (+ provider/credentials/email.py::EmailProvider + adapter/base.py::Adapter, is_signup=True)
 *  - plane/authentication/views/app/email.py::SignInAuthEndpoint    -> signIn
 *    (+ provider/credentials/email.py::EmailProvider + adapter/base.py::Adapter, is_signup=False)
 * Every failure path raises AuthError with the exact Django error_code -- never null/generic throws.
 */
@Injectable()
export class EmailProvider {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly auth: AuthService,
    private readonly instanceConfig: InstanceConfigService,
  ) {}

  /** plane/authentication/views/app/check.py::EmailCheckEndpoint.post */
  async emailCheck(email: string): Promise<{ existing: boolean; status: "MAGIC_CODE" | "CREDENTIAL" }> {
    if (!email) {
      throw new AuthError({ code: AUTHENTICATION_ERROR_CODES.EMAIL_REQUIRED, message: "EMAIL_REQUIRED" });
    }
    const normalized = this.normalize(email);
    if (!EMAIL_RE.test(normalized)) {
      throw new AuthError({ code: AUTHENTICATION_ERROR_CODES.INVALID_EMAIL, message: "INVALID_EMAIL" });
    }

    const [emailHost, enableMagicLinkLogin] = await this.instanceConfig.getConfigurationValues([
      { key: "EMAIL_HOST", default: "" },
      { key: "ENABLE_MAGIC_LINK_LOGIN", default: "1" },
    ]);
    const smtpConfigured = Boolean(emailHost);
    const magicLoginEnabled = enableMagicLinkLogin === "1";

    const existingUser = await this.auth.findUserByEmail(normalized);
    if (existingUser) {
      const status =
        existingUser.isPasswordAutoset && smtpConfigured && magicLoginEnabled ? "MAGIC_CODE" : "CREDENTIAL";
      return { existing: true, status };
    }
    return { existing: false, status: smtpConfigured && magicLoginEnabled ? "MAGIC_CODE" : "CREDENTIAL" };
  }

  /** plane/authentication/views/app/email.py::SignUpAuthEndpoint + the adapter gates it triggers. */
  async signUp(email: string, password: string): Promise<User> {
    if (!email || !password) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.REQUIRED_EMAIL_PASSWORD_SIGN_UP,
        message: "REQUIRED_EMAIL_PASSWORD_SIGN_UP",
        payload: { email: String(email) },
      });
    }
    const normalized = this.normalize(email);
    if (!EMAIL_RE.test(normalized)) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.INVALID_EMAIL_SIGN_UP,
        message: "INVALID_EMAIL_SIGN_UP",
        payload: { email: normalized },
      });
    }

    // View-level check (email.py) -- ahead of the EmailProvider construction below.
    if (await this.auth.findUserByEmail(normalized)) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.USER_ALREADY_EXIST,
        message: "USER_ALREADY_EXIST",
        payload: { email: normalized },
      });
    }

    // EmailProvider.__init__ gate (provider/credentials/email.py) -- applies to sign-up too, it does
    // not branch on is_signup.
    const [enableEmailPassword] = await this.instanceConfig.getConfigurationValues([
      { key: "ENABLE_EMAIL_PASSWORD", default: undefined },
    ]);
    if (enableEmailPassword === "0") {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.EMAIL_PASSWORD_AUTHENTICATION_DISABLED,
        message: "EMAIL_PASSWORD_AUTHENTICATION_DISABLED",
      });
    }

    // Adapter.__check_signup (adapter/base.py) -- disabled signup is still allowed for an invited
    // email; requires the workspace_member_invites table from Task 7.
    const [enableSignup] = await this.instanceConfig.getConfigurationValues([
      { key: "ENABLE_SIGNUP", default: "1" },
    ]);
    if (enableSignup === "0" && !(await this.hasWorkspaceInvite(normalized))) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.SIGNUP_DISABLED,
        message: "SIGNUP_DISABLED",
        payload: { email: normalized },
      });
    }

    // Adapter.validate_password (adapter/base.py)
    if (zxcvbn(password).score < 3) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.PASSWORD_TOO_WEAK,
        message: "PASSWORD_TOO_WEAK",
        payload: { email: normalized },
      });
    }

    // Adapter.complete_login_or_signup new-user branch + save_user_data (adapter/base.py): create the
    // user (same required columns as AdminSeedService) and its profile row.
    const now = new Date();
    const userId = randomUUID();
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          id: userId,
          email: normalized,
          username: randomUUID().replace(/-/g, ""),
          password: makeDjangoPassword(password),
          firstName: "",
          lastName: "",
          isPasswordAutoset: false,
          isActive: true,
          lastActive: now,
          lastLoginTime: now,
          lastLoginMedium: "email",
          tokenUpdatedAt: now,
          dateJoined: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx.insert(profiles).values({ userId: user.id });
      return user;
    });
  }

  /** plane/authentication/views/app/email.py::SignInAuthEndpoint + the adapter gates it triggers. */
  async signIn(email: string, password: string): Promise<User> {
    if (!email || !password) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.REQUIRED_EMAIL_PASSWORD_SIGN_IN,
        message: "REQUIRED_EMAIL_PASSWORD_SIGN_IN",
        payload: { email: String(email) },
      });
    }
    const normalized = this.normalize(email);
    if (!EMAIL_RE.test(normalized)) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.INVALID_EMAIL_SIGN_IN,
        message: "INVALID_EMAIL_SIGN_IN",
        payload: { email: normalized },
      });
    }

    // View-level check (email.py) -- ahead of the EmailProvider construction below. Looked up
    // regardless of is_active: Django's User.objects.filter(email=...) carries no active filter, so a
    // deactivated account must fail later with USER_ACCOUNT_DEACTIVATED, not USER_DOES_NOT_EXIST.
    const user = await this.auth.findUserByEmail(normalized);
    if (!user) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.USER_DOES_NOT_EXIST,
        message: "USER_DOES_NOT_EXIST",
        payload: { email: normalized },
      });
    }

    // EmailProvider.__init__ gate (provider/credentials/email.py)
    const [enableEmailPassword] = await this.instanceConfig.getConfigurationValues([
      { key: "ENABLE_EMAIL_PASSWORD", default: undefined },
    ]);
    if (enableEmailPassword === "0") {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.EMAIL_PASSWORD_AUTHENTICATION_DISABLED,
        message: "EMAIL_PASSWORD_AUTHENTICATION_DISABLED",
      });
    }

    // EmailProvider.set_user_data, is_signup=False branch (provider/credentials/email.py)
    if (!user.password || !verifyDjangoPassword(password, user.password)) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.AUTHENTICATION_FAILED_SIGN_IN,
        message: "AUTHENTICATION_FAILED_SIGN_IN",
        payload: { email: normalized },
      });
    }

    // Adapter.complete_login_or_signup (adapter/base.py): only an *explicitly* deactivated account
    // (last_logout_time set) is rejected -- a merely is_active=false row that was never logged out is
    // let through and reactivated by save_user_data, matching GHSA-rmmf-rj2q-3rrg's fix.
    if (!user.isActive && user.lastLogoutTime !== null) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.USER_ACCOUNT_DEACTIVATED,
        message: "USER_ACCOUNT_DEACTIVATED",
        payload: { email: normalized },
      });
    }

    return user;
  }

  private normalize(email: unknown): string {
    return String(email).toLowerCase().trim();
  }

  private async hasWorkspaceInvite(email: string): Promise<boolean> {
    const [invite] = await this.db
      .select({ id: workspaceMemberInvites.id })
      .from(workspaceMemberInvites)
      .where(and(eq(workspaceMemberInvites.email, email), isNull(workspaceMemberInvites.deletedAt)))
      .limit(1);
    return Boolean(invite);
  }
}
