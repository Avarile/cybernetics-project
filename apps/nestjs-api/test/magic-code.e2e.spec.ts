import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import * as schema from "../src/infra/database/schema";
import { users } from "../src/infra/database/schema";
import { ConfigService } from "../src/infra/config/config.service";
import { CryptoService } from "../src/infra/config/crypto.service";
import { InstanceConfigService } from "../src/infra/config/instance-config.service";
import { MagicCodeService } from "../src/modules/auth/magic/magic-code.service";
import { AUTHENTICATION_ERROR_CODES } from "../src/infra/auth/error-codes";

// Faithful port of magic_code.py (MagicCodeProvider.initiate + set_user_data) against the real test
// Redis (flushed per test) and plane_test Postgres (for the sign-in-vs-sign-up user-exists branch).
// instance_configurations rows for EMAIL_HOST/ENABLE_MAGIC_LINK_LOGIN are upserted per-test and always
// removed in `finally` so later suites see the untouched default -- same discipline as
// email-provider.e2e.spec.ts.
describe("MagicCodeService", () => {
  const redis = new Redis(process.env.REDIS_URL!);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  const cfg = new ConfigService();
  const crypto = new CryptoService(cfg);
  crypto.onModuleInit();
  const instanceConfig = new InstanceConfigService(db as never, crypto, cfg);
  const svc = new MagicCodeService(redis as never, db as never, instanceConfig);

  const userIds: string[] = [];

  function email(tag: string) {
    return `mc-${tag}-${randomUUID()}@test.dev`;
  }

  async function insertUser(addr: string) {
    const id = randomUUID();
    userIds.push(id);
    const now = new Date();
    await db.insert(users).values({ id, email: addr, isActive: true, createdAt: now, updatedAt: now });
    return id;
  }

  async function setConfig(key: string, value: string) {
    await pool.query(
      `INSERT INTO instance_configurations (id, key, value, category, is_encrypted, created_at, updated_at)
       VALUES ($1, $2, $3, 'AUTHENTICATION', false, now(), now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [randomUUID(), key, value],
    );
  }

  async function clearConfig(key: string) {
    await pool.query(`DELETE FROM instance_configurations WHERE key = $1`, [key]);
  }

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await redis.quit();
    await pool.end();
  });

  describe("assertEnabled", () => {
    it("throws SMTP_NOT_CONFIGURED when EMAIL_HOST is not set", async () => {
      // db-env.sh exports EMAIL_HOST so the SMTP gate passes for the rest of the suite (assertEnabled
      // falls back to process.env.EMAIL_HOST when the DB row is empty) -- unset it for this one case.
      const envEmailHost = process.env.EMAIL_HOST;
      delete process.env.EMAIL_HOST;
      await setConfig("EMAIL_HOST", "");
      await setConfig("ENABLE_MAGIC_LINK_LOGIN", "1");
      try {
        await expect(svc.assertEnabled(email("gate-smtp"))).rejects.toMatchObject({
          errorCode: String(AUTHENTICATION_ERROR_CODES.SMTP_NOT_CONFIGURED),
        });
      } finally {
        process.env.EMAIL_HOST = envEmailHost;
        await clearConfig("EMAIL_HOST");
        await clearConfig("ENABLE_MAGIC_LINK_LOGIN");
      }
    });

    it("throws MAGIC_LINK_LOGIN_DISABLED when the gate is off", async () => {
      await setConfig("EMAIL_HOST", "smtp.example.com");
      await setConfig("ENABLE_MAGIC_LINK_LOGIN", "0");
      try {
        await expect(svc.assertEnabled(email("gate-disabled"))).rejects.toMatchObject({
          errorCode: String(AUTHENTICATION_ERROR_CODES.MAGIC_LINK_LOGIN_DISABLED),
        });
      } finally {
        await clearConfig("EMAIL_HOST");
        await clearConfig("ENABLE_MAGIC_LINK_LOGIN");
      }
    });

    it("passes when EMAIL_HOST is set and magic link login is enabled", async () => {
      await setConfig("EMAIL_HOST", "smtp.example.com");
      await setConfig("ENABLE_MAGIC_LINK_LOGIN", "1");
      try {
        await expect(svc.assertEnabled(email("gate-ok"))).resolves.toBeUndefined();
      } finally {
        await clearConfig("EMAIL_HOST");
        await clearConfig("ENABLE_MAGIC_LINK_LOGIN");
      }
    });
  });

  describe("initiate", () => {
    it("issues a 6-digit code keyed by magic_<email>", async () => {
      const addr = email("issue");
      const { key, token } = await svc.initiate(addr);
      expect(key).toBe(`magic_${addr}`);
      expect(token).toMatch(/^\d{6}$/);
      expect(await redis.exists(key)).toBe(1);
    });

    it("resets the verify-attempts counter on every generate", async () => {
      const addr = email("reset-counter");
      const { key } = await svc.initiate(addr);
      await expect(svc.verify(key, "000000")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.INVALID_MAGIC_CODE_SIGN_UP),
      });
      expect(await redis.get(`${key}:verify_attempts`)).toBe("1");

      await svc.initiate(addr);
      expect(await redis.exists(`${key}:verify_attempts`)).toBe(0);
    });

    // Django's check is `data.current_attempt > 2` evaluated BEFORE incrementing the stored value,
    // so calls 1-4 (current_attempt: 0,1,2,3) all succeed and only the 5th call (reads stored `3`) is
    // blocked -- ported verbatim, off-by-one included.
    it("the 5th generate within TTL -> EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP for an unknown email", async () => {
      const addr = email("generate-exhausted-signup");
      for (let i = 0; i < 4; i++) {
        await expect(svc.initiate(addr)).resolves.toMatchObject({ key: `magic_${addr}` });
      }
      await expect(svc.initiate(addr)).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP),
      });
    });

    it("the 5th generate within TTL -> EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN when a users row exists", async () => {
      const addr = email("generate-exhausted-signin");
      await insertUser(addr);
      for (let i = 0; i < 4; i++) {
        await svc.initiate(addr);
      }
      await expect(svc.initiate(addr)).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN),
      });
    });
  });

  describe("verify", () => {
    it("verifies the correct code once, then the key (and counter) are gone", async () => {
      const addr = email("verify-once");
      const { key, token } = await svc.initiate(addr);

      const result = await svc.verify(key, token);
      expect(result).toEqual({ email: addr });

      expect(await redis.exists(key)).toBe(0);
      expect(await redis.exists(`${key}:verify_attempts`)).toBe(0);
    });

    it("a wrong code raises INVALID_MAGIC_CODE_SIGN_UP for an unknown email and increments the counter", async () => {
      const addr = email("verify-wrong-signup");
      const { key } = await svc.initiate(addr);

      await expect(svc.verify(key, "000000")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.INVALID_MAGIC_CODE_SIGN_UP),
      });
      expect(await redis.get(`${key}:verify_attempts`)).toBe("1");
    });

    it("a wrong code raises INVALID_MAGIC_CODE_SIGN_IN when a users row exists for the email", async () => {
      const addr = email("verify-wrong-signin");
      await insertUser(addr);
      const { key } = await svc.initiate(addr);

      await expect(svc.verify(key, "000000")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.INVALID_MAGIC_CODE_SIGN_IN),
      });
    });

    it("5 wrong codes -> INVALID for the first 4, EXHAUSTED (+ token invalidated) on the 5th", async () => {
      const addr = email("verify-exhausted");
      const { key } = await svc.initiate(addr);

      for (let i = 0; i < 4; i++) {
        await expect(svc.verify(key, "000000")).rejects.toMatchObject({
          errorCode: String(AUTHENTICATION_ERROR_CODES.INVALID_MAGIC_CODE_SIGN_UP),
        });
      }
      await expect(svc.verify(key, "000000")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP),
      });

      // token invalidated: even the real code no longer verifies, the key is gone (EXPIRED now).
      expect(await redis.exists(key)).toBe(0);
      expect(await redis.exists(`${key}:verify_attempts`)).toBe(0);
    });

    it("missing/expired key -> EXPIRED_MAGIC_CODE_SIGN_UP for an unknown email", async () => {
      const addr = email("expired-signup");
      await expect(svc.verify(`magic_${addr}`, "123456")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.EXPIRED_MAGIC_CODE_SIGN_UP),
      });
    });

    it("missing/expired key -> EXPIRED_MAGIC_CODE_SIGN_IN when a users row exists", async () => {
      const addr = email("expired-signin");
      await insertUser(addr);
      await expect(svc.verify(`magic_${addr}`, "123456")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.EXPIRED_MAGIC_CODE_SIGN_IN),
      });
    });
  });
});
