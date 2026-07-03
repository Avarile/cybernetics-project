import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import * as schema from "../src/infra/database/schema";
import { profiles, users, workspaceMemberInvites, workspaces } from "../src/infra/database/schema";
import { ConfigService } from "../src/infra/config/config.service";
import { CryptoService } from "../src/infra/config/crypto.service";
import { InstanceConfigService } from "../src/infra/config/instance-config.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { EmailProvider } from "../src/modules/auth/email.provider";
import { verifyDjangoPassword } from "../src/infra/auth/django-password";
import { AuthError, AUTHENTICATION_ERROR_CODES } from "../src/infra/auth/error-codes";

// Faithful port of check.py (EmailCheckEndpoint) + email.py (SignUpAuthEndpoint/SignInAuthEndpoint) +
// the adapter gates they trigger (adapter/base.py, provider/credentials/email.py). Seeds its own rows
// against plane_test and cleans them up; instance_configurations rows are upserted per-test to flip
// gates and always removed in `finally` so later suites see the untouched default.
describe("EmailProvider", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  const cfg = new ConfigService();
  const crypto = new CryptoService(cfg);
  crypto.onModuleInit();
  const instanceConfig = new InstanceConfigService(db as never, crypto, cfg);
  const auth = new AuthService(db as never);
  const provider = new EmailProvider(db as never, auth, instanceConfig);

  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const inviteIds: string[] = [];

  function email(tag: string) {
    return `ep-${tag}-${randomUUID()}@test.dev`;
  }

  async function insertUser(overrides: Partial<typeof users.$inferInsert> & { email: string }) {
    const id = overrides.id ?? randomUUID();
    userIds.push(id);
    const now = new Date();
    await db.insert(users).values({
      id,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
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

  afterAll(async () => {
    if (inviteIds.length) await db.delete(workspaceMemberInvites).where(inArray(workspaceMemberInvites.id, inviteIds));
    if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    if (userIds.length) await db.delete(profiles).where(inArray(profiles.userId, userIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  });

  describe("emailCheck", () => {
    it("throws EMAIL_REQUIRED when email is missing", async () => {
      await expect(provider.emailCheck("")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.EMAIL_REQUIRED),
      });
    });

    it("throws INVALID_EMAIL for a malformed email", async () => {
      await expect(provider.emailCheck("not-an-email")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.INVALID_EMAIL),
      });
    });

    it("new user, magic login enabled + smtp configured -> MAGIC_CODE", async () => {
      await setConfig("EMAIL_HOST", "smtp.example.com");
      await setConfig("ENABLE_MAGIC_LINK_LOGIN", "1");
      try {
        const result = await provider.emailCheck(email("check-new-magic"));
        expect(result).toEqual({ existing: false, status: "MAGIC_CODE" });
      } finally {
        await clearConfig("EMAIL_HOST");
        await clearConfig("ENABLE_MAGIC_LINK_LOGIN");
      }
    });

    it("new user, magic login disabled -> CREDENTIAL even with smtp configured", async () => {
      await setConfig("EMAIL_HOST", "smtp.example.com");
      await setConfig("ENABLE_MAGIC_LINK_LOGIN", "0");
      try {
        const result = await provider.emailCheck(email("check-new-nomagic"));
        expect(result).toEqual({ existing: false, status: "CREDENTIAL" });
      } finally {
        await clearConfig("EMAIL_HOST");
        await clearConfig("ENABLE_MAGIC_LINK_LOGIN");
      }
    });

    it("existing user with is_password_autoset -> MAGIC_CODE (gates satisfied)", async () => {
      const addr = email("check-autoset");
      await insertUser({ email: addr, isPasswordAutoset: true });
      await setConfig("EMAIL_HOST", "smtp.example.com");
      await setConfig("ENABLE_MAGIC_LINK_LOGIN", "1");
      try {
        const result = await provider.emailCheck(addr);
        expect(result).toEqual({ existing: true, status: "MAGIC_CODE" });
      } finally {
        await clearConfig("EMAIL_HOST");
        await clearConfig("ENABLE_MAGIC_LINK_LOGIN");
      }
    });

    it("existing user with a set password -> CREDENTIAL even with gates satisfied", async () => {
      const addr = email("check-haspw");
      await insertUser({ email: addr, isPasswordAutoset: false });
      await setConfig("EMAIL_HOST", "smtp.example.com");
      await setConfig("ENABLE_MAGIC_LINK_LOGIN", "1");
      try {
        const result = await provider.emailCheck(addr);
        expect(result).toEqual({ existing: true, status: "CREDENTIAL" });
      } finally {
        await clearConfig("EMAIL_HOST");
        await clearConfig("ENABLE_MAGIC_LINK_LOGIN");
      }
    });
  });

  describe("signUp", () => {
    it("throws INVALID_EMAIL_SIGN_UP for a malformed email", async () => {
      await expect(provider.signUp("not-an-email", "Tr0ub4dor&3xyz")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.INVALID_EMAIL_SIGN_UP),
      });
    });

    it("throws USER_ALREADY_EXIST for an existing email", async () => {
      const addr = email("signup-exists");
      await insertUser({ email: addr });
      await expect(provider.signUp(addr, "Tr0ub4dor&3xyz")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.USER_ALREADY_EXIST),
      });
    });

    it("throws EMAIL_PASSWORD_AUTHENTICATION_DISABLED when the gate is off", async () => {
      await setConfig("ENABLE_EMAIL_PASSWORD", "0");
      try {
        await expect(provider.signUp(email("signup-pwoff"), "Tr0ub4dor&3xyz")).rejects.toMatchObject({
          errorCode: String(AUTHENTICATION_ERROR_CODES.EMAIL_PASSWORD_AUTHENTICATION_DISABLED),
        });
      } finally {
        await clearConfig("ENABLE_EMAIL_PASSWORD");
      }
    });

    it("throws SIGNUP_DISABLED when ENABLE_SIGNUP is off and there's no invite", async () => {
      await setConfig("ENABLE_SIGNUP", "0");
      try {
        await expect(provider.signUp(email("signup-off"), "Tr0ub4dor&3xyz")).rejects.toMatchObject({
          errorCode: String(AUTHENTICATION_ERROR_CODES.SIGNUP_DISABLED),
        });
      } finally {
        await clearConfig("ENABLE_SIGNUP");
      }
    });

    it("allows sign-up when ENABLE_SIGNUP is off but a workspace invite exists for the email", async () => {
      const addr = email("signup-invited");
      const ownerId = await insertUser({ email: email("signup-inviter") });
      const wsId = randomUUID();
      workspaceIds.push(wsId);
      await db.insert(workspaces).values({ id: wsId, name: "ep-ws", slug: `ep-ws-${wsId.slice(0, 8)}`, ownerId });
      const inviteId = randomUUID();
      inviteIds.push(inviteId);
      await db.insert(workspaceMemberInvites).values({ id: inviteId, workspaceId: wsId, email: addr, token: randomUUID() });

      await setConfig("ENABLE_SIGNUP", "0");
      try {
        const user = await provider.signUp(addr, "Tr0ub4dor&3xyz");
        userIds.push(user.id);
        expect(user.email).toBe(addr);
      } finally {
        await clearConfig("ENABLE_SIGNUP");
      }
    });

    it("throws INVALID_PASSWORD for a weak password", async () => {
      await expect(provider.signUp(email("signup-weak"), "password")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.INVALID_PASSWORD),
      });
    });

    it("creates the user + profile row with a verifiable password hash", async () => {
      const addr = email("signup-ok");
      const user = await provider.signUp(addr, "Tr0ub4dor&3xyz");
      userIds.push(user.id);

      expect(user.email).toBe(addr);
      expect(user.isPasswordAutoset).toBe(false);
      expect(user.isActive).toBe(true);
      expect(verifyDjangoPassword("Tr0ub4dor&3xyz", user.password!)).toBe(true);

      const [profileRow] = await db.select().from(profiles).where(inArray(profiles.userId, [user.id]));
      expect(profileRow).toBeDefined();
    });
  });

  describe("signIn", () => {
    it("throws USER_DOES_NOT_EXIST for an unknown email", async () => {
      await expect(provider.signIn(email("signin-unknown"), "whatever")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.USER_DOES_NOT_EXIST),
      });
    });

    it("throws EMAIL_PASSWORD_AUTHENTICATION_DISABLED when the gate is off", async () => {
      const addr = email("signin-pwoff");
      await insertUser({ email: addr, password: "pbkdf2_sha256$600000$salt$abc" });
      await setConfig("ENABLE_EMAIL_PASSWORD", "0");
      try {
        await expect(provider.signIn(addr, "whatever")).rejects.toMatchObject({
          errorCode: String(AUTHENTICATION_ERROR_CODES.EMAIL_PASSWORD_AUTHENTICATION_DISABLED),
        });
      } finally {
        await clearConfig("ENABLE_EMAIL_PASSWORD");
      }
    });

    it("throws AUTHENTICATION_FAILED for a wrong password", async () => {
      const addr = email("signin-badpw");
      const password = "Tr0ub4dor&3xyz";
      const created = await provider.signUp(addr, password);
      userIds.push(created.id);

      await expect(provider.signIn(addr, "wrong-password")).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.AUTHENTICATION_FAILED),
      });
    });

    it("throws USER_ACCOUNT_DEACTIVATED for an inactive account, even with the correct password", async () => {
      const addr = email("signin-deactivated");
      const password = "Tr0ub4dor&3xyz";
      const created = await provider.signUp(addr, password);
      userIds.push(created.id);
      await db.update(users).set({ isActive: false }).where(inArray(users.id, [created.id]));

      await expect(provider.signIn(addr, password)).rejects.toMatchObject({
        errorCode: String(AUTHENTICATION_ERROR_CODES.USER_ACCOUNT_DEACTIVATED),
      });
    });

    it("signs in with correct credentials", async () => {
      const addr = email("signin-ok");
      const password = "Tr0ub4dor&3xyz";
      const created = await provider.signUp(addr, password);
      userIds.push(created.id);

      const user = await provider.signIn(addr, password);
      expect(user.id).toBe(created.id);
    });
  });
});
