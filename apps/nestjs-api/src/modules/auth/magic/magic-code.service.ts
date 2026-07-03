import { randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type Redis from "ioredis";
import { REDIS } from "../../../infra/cache/redis.module";
import { DRIZZLE, type Database } from "../../../infra/database/drizzle.module";
import { users } from "../../../infra/database/schema";
import { InstanceConfigService } from "../../../infra/config/instance-config.service";
import { AuthError, AUTHENTICATION_ERROR_CODES } from "../../../infra/auth/error-codes";

const MAGIC_KEY_PREFIX = "magic_";
const MAGIC_CODE_TTL_SECONDS = 600;
// Max wrong-code verification attempts per issued token before the token is invalidated. Prevents
// brute-forcing the 6-digit code space within the token TTL window.
const MAX_VERIFY_ATTEMPTS = 5;
// Max generate ("resend") attempts per issued token before the caller is locked out until the
// token expires. current_attempt is 0-based, so ">2" is the 4th generate call.
const MAX_GENERATE_ATTEMPT = 2;

// Atomic INCR + first-time EXPIRE for the verify-attempt counter, ported verbatim from
// magic_code.py::_INCREMENT_VERIFY_ATTEMPTS_SCRIPT. A dedicated counter key with this script makes
// the increment safe under concurrent wrong-code requests; a plain JSON read/modify/write would
// race and let parallel attackers exceed the cap.
const INCREMENT_VERIFY_ATTEMPTS_SCRIPT =
  'local count = redis.call("INCR", KEYS[1]) ' +
  "if count == 1 then " +
  '    redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1])) ' +
  "end " +
  "return count";

interface MagicCodeValue {
  current_attempt: number;
  email: string;
  token: string;
}

/**
 * Redis-backed magic-code state machine. Faithful port of
 * apps/api/plane/authentication/provider/credentials/magic_code.py (MagicCodeProvider).
 * `initiate` == `MagicCodeProvider.initiate`, `verify` == `MagicCodeProvider.set_user_data`
 * (the code-matching half only -- user/session creation is the caller's job, Task 2+).
 */
@Injectable()
export class MagicCodeService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly instanceConfig: InstanceConfigService,
  ) {}

  /** MagicCodeProvider.__init__ gate. Passing env vars as defaults mirrors os.environ.get(...) so an
   * empty/absent InstanceConfiguration row falls back to the environment, not to a hardcoded value. */
  async assertEnabled(email: string): Promise<void> {
    const [emailHost, enableMagicLinkLogin] = await this.instanceConfig.getConfigurationValues([
      { key: "EMAIL_HOST", default: process.env.EMAIL_HOST },
      { key: "ENABLE_MAGIC_LINK_LOGIN", default: process.env.ENABLE_MAGIC_LINK_LOGIN ?? "1" },
    ]);

    if (!emailHost) {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.SMTP_NOT_CONFIGURED,
        message: "SMTP_NOT_CONFIGURED",
        payload: { email },
      });
    }
    if (enableMagicLinkLogin === "0") {
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.MAGIC_LINK_LOGIN_DISABLED,
        message: "MAGIC_LINK_LOGIN_DISABLED",
        payload: { email },
      });
    }
  }

  /** MagicCodeProvider.initiate. */
  async initiate(email: string): Promise<{ key: string; token: string }> {
    const token = String(randomInt(100000, 1000000));
    const key = `${MAGIC_KEY_PREFIX}${email}`;

    const existing = await this.redis.get(key);
    let value: MagicCodeValue;

    if (existing !== null) {
      const data = JSON.parse(existing) as MagicCodeValue;

      if (data.current_attempt > MAX_GENERATE_ATTEMPT) {
        if (await this.userExists(email)) {
          throw new AuthError({
            code: AUTHENTICATION_ERROR_CODES.EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN,
            message: "EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN",
            payload: { email },
          });
        }
        throw new AuthError({
          code: AUTHENTICATION_ERROR_CODES.EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP,
          message: "EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP",
          payload: { email },
        });
      }

      value = { current_attempt: data.current_attempt + 1, email, token };
    } else {
      value = { current_attempt: 0, email, token };
    }

    await this.redis.set(key, JSON.stringify(value), "EX", MAGIC_CODE_TTL_SECONDS);
    // Reset the verify-attempt counter so each newly issued token starts with a fresh budget of
    // MAX_VERIFY_ATTEMPTS.
    await this.redis.del(this.verifyAttemptsKey(key));
    return { key, token };
  }

  /** MagicCodeProvider.set_user_data (code-matching half). */
  async verify(key: string, code: string): Promise<{ email: string }> {
    const bareEmail = this.stripMagicPrefix(key);
    const raw = await this.redis.get(key);

    if (raw === null) {
      if (await this.userExists(bareEmail)) {
        throw new AuthError({
          code: AUTHENTICATION_ERROR_CODES.EXPIRED_MAGIC_CODE_SIGN_IN,
          message: "EXPIRED_MAGIC_CODE_SIGN_IN",
          payload: { email: bareEmail },
        });
      }
      throw new AuthError({
        code: AUTHENTICATION_ERROR_CODES.EXPIRED_MAGIC_CODE_SIGN_UP,
        message: "EXPIRED_MAGIC_CODE_SIGN_UP",
        payload: { email: bareEmail },
      });
    }

    const data = JSON.parse(raw) as MagicCodeValue;

    if (String(data.token) === String(code)) {
      await this.redis.del(key);
      await this.redis.del(this.verifyAttemptsKey(key));
      return { email: data.email };
    }

    const userExists = await this.userExists(bareEmail);

    // Clamp to >=1 because EXPIRE key 0 immediately deletes the key and would let an attacker
    // bypass the cap in the final second (ttl() returns -2 missing, -1 no expiry, or seconds left).
    const remaining = Math.max(1, await this.redis.ttl(key));
    const attempts = Number(
      await this.redis.eval(INCREMENT_VERIFY_ATTEMPTS_SCRIPT, 1, this.verifyAttemptsKey(key), remaining),
    );

    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      // Invalidate the token (and counter) so further attempts must regenerate; regeneration is
      // itself attempt-counted.
      await this.redis.del(key);
      await this.redis.del(this.verifyAttemptsKey(key));
      throw new AuthError({
        code: userExists
          ? AUTHENTICATION_ERROR_CODES.EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN
          : AUTHENTICATION_ERROR_CODES.EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP,
        message: userExists ? "EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN" : "EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP",
        payload: { email: bareEmail },
      });
    }

    throw new AuthError({
      code: userExists ? AUTHENTICATION_ERROR_CODES.INVALID_MAGIC_CODE_SIGN_IN : AUTHENTICATION_ERROR_CODES.INVALID_MAGIC_CODE_SIGN_UP,
      message: userExists ? "INVALID_MAGIC_CODE_SIGN_IN" : "INVALID_MAGIC_CODE_SIGN_UP",
      payload: { email: bareEmail },
    });
  }

  private verifyAttemptsKey(tokenKey: string): string {
    return `${tokenKey}:verify_attempts`;
  }

  private stripMagicPrefix(key: string): string {
    return key.startsWith(MAGIC_KEY_PREFIX) ? key.slice(MAGIC_KEY_PREFIX.length) : key;
  }

  private async userExists(email: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return Boolean(row);
  }
}
