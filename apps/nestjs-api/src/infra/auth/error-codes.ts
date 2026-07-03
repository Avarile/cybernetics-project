/**
 * Ported verbatim from apps/api/plane/authentication/adapter/error.py
 * (AUTHENTICATION_ERROR_CODES + AuthenticationException). Keep in lockstep with the Django dict —
 * do not renumber or rename keys, the codes are part of the app/space client contract.
 */
export const AUTHENTICATION_ERROR_CODES: Record<string, number> = {
  // Global
  INSTANCE_NOT_CONFIGURED: 5000,
  INVALID_EMAIL: 5005,
  EMAIL_REQUIRED: 5010,
  SIGNUP_DISABLED: 5015,
  MAGIC_LINK_LOGIN_DISABLED: 5016,
  PASSWORD_LOGIN_DISABLED: 5018,
  USER_ACCOUNT_DEACTIVATED: 5019,
  // Password strength
  INVALID_PASSWORD: 5020,
  PASSWORD_TOO_WEAK: 5021,
  SMTP_NOT_CONFIGURED: 5025,
  // Sign Up
  USER_ALREADY_EXIST: 5030,
  AUTHENTICATION_FAILED_SIGN_UP: 5035,
  REQUIRED_EMAIL_PASSWORD_SIGN_UP: 5040,
  INVALID_EMAIL_SIGN_UP: 5045,
  INVALID_EMAIL_MAGIC_SIGN_UP: 5050,
  MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED: 5055,
  EMAIL_PASSWORD_AUTHENTICATION_DISABLED: 5056,
  // Sign In
  USER_DOES_NOT_EXIST: 5060,
  AUTHENTICATION_FAILED_SIGN_IN: 5065,
  REQUIRED_EMAIL_PASSWORD_SIGN_IN: 5070,
  INVALID_EMAIL_SIGN_IN: 5075,
  INVALID_EMAIL_MAGIC_SIGN_IN: 5080,
  MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED: 5085,
  // Both Sign in and Sign up for magic
  INVALID_MAGIC_CODE_SIGN_IN: 5090,
  INVALID_MAGIC_CODE_SIGN_UP: 5092,
  EXPIRED_MAGIC_CODE_SIGN_IN: 5095,
  EXPIRED_MAGIC_CODE_SIGN_UP: 5097,
  EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN: 5100,
  EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP: 5102,
  // Oauth
  OAUTH_NOT_CONFIGURED: 5104,
  GOOGLE_NOT_CONFIGURED: 5105,
  GITHUB_NOT_CONFIGURED: 5110,
  GITHUB_USER_NOT_IN_ORG: 5122,
  GITLAB_NOT_CONFIGURED: 5111,
  GITEA_NOT_CONFIGURED: 5112,
  GOOGLE_OAUTH_PROVIDER_ERROR: 5115,
  GITHUB_OAUTH_PROVIDER_ERROR: 5120,
  GITLAB_OAUTH_PROVIDER_ERROR: 5121,
  GITEA_OAUTH_PROVIDER_ERROR: 5123,
  // Reset Password
  INVALID_PASSWORD_TOKEN: 5125,
  EXPIRED_PASSWORD_TOKEN: 5130,
  // Change password
  INCORRECT_OLD_PASSWORD: 5135,
  MISSING_PASSWORD: 5138,
  INVALID_NEW_PASSWORD: 5140,
  // set password
  PASSWORD_ALREADY_SET: 5145,
  // Admin
  ADMIN_ALREADY_EXIST: 5150,
  REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME: 5155,
  INVALID_ADMIN_EMAIL: 5160,
  INVALID_ADMIN_PASSWORD: 5165,
  REQUIRED_ADMIN_EMAIL_PASSWORD: 5170,
  ADMIN_AUTHENTICATION_FAILED: 5175,
  ADMIN_USER_ALREADY_EXIST: 5180,
  ADMIN_USER_DOES_NOT_EXIST: 5185,
  ADMIN_USER_DEACTIVATED: 5190,
  // Rate limit
  RATE_LIMIT_EXCEEDED: 5900,
  // Unknown
  AUTHENTICATION_FAILED: 5999,
};

/** Ported from AuthenticationException (get_error_dict) with an added HTTP `status`. */
export class AuthError extends Error {
  readonly errorCode: string;
  readonly payload: Record<string, string>;
  readonly status: number;

  constructor(opts: { code: number | string; message: string; payload?: Record<string, string> }) {
    super(opts.message);
    this.errorCode = String(opts.code);
    this.payload = opts.payload ?? {};
    this.status = String(opts.code) === String(AUTHENTICATION_ERROR_CODES.RATE_LIMIT_EXCEEDED) ? 429 : 400;
  }

  getErrorDict(): Record<string, string> {
    return { error_code: this.errorCode, error_message: this.message, ...this.payload };
  }
}
