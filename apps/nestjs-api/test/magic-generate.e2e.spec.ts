// Env must be set before AppModule providers instantiate.
process.env.DATABASE_URL ??= "postgresql://plane:plane@localhost:5433/plane_test";
process.env.SECRET_KEY ??= "e2e-test-secret-key";
process.env.REDIS_URL ??= "redis://localhost:6379/0";
process.env.AMQP_URL ??= "amqp://guest:guest@localhost:5672/";

import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import Redis from "ioredis";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { AUTHENTICATION_ERROR_CODES } from "../src/infra/auth/error-codes";
import { MailerService } from "../src/infra/mailer/mailer.service";

// plane/authentication/views/app/magic.py::MagicGenerateEndpoint. plane_test's seed writes
// ENABLE_MAGIC_LINK_LOGIN='0' and EMAIL_HOST='' (magic disabled by default -- see
// email-check.e2e.spec.ts's "magic disabled by default seed" comment); this suite upserts both to
// enabled values for its own duration and always restores them in `afterAll`, mirroring the
// instance_configurations restore discipline in email-provider.e2e.spec.ts / magic-code.e2e.spec.ts
// -- leaving them flipped would break other e2e suites that assume the disabled default.
let app: INestApplication;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL!);
const mailerSend = vi.fn().mockResolvedValue(undefined);

async function setConfig(key: string, value: string) {
  await pool.query(
    `INSERT INTO instance_configurations (id, key, value, category, is_encrypted, created_at, updated_at)
     VALUES ($1, $2, $3, 'AUTHENTICATION', false, now(), now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [randomUUID(), key, value],
  );
}

beforeAll(async () => {
  await setConfig("ENABLE_MAGIC_LINK_LOGIN", "1");
  await setConfig("EMAIL_HOST", "smtp.test.local");

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailerService)
    .useValue({ send: mailerSend })
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterEach(() => {
  mailerSend.mockClear();
});

afterAll(async () => {
  try {
    await app.close();
  } finally {
    try {
      await setConfig("ENABLE_MAGIC_LINK_LOGIN", "0");
      await setConfig("EMAIL_HOST", "");
    } finally {
      await redis.quit();
      await pool.end();
    }
  }
});

function email(tag: string) {
  return `mg-${tag}-${randomUUID()}@x.io`;
}

describe.each([
  ["/auth/magic-generate", "app"],
  ["/auth/spaces/magic-generate", "space"],
] as const)("POST %s", (path) => {
  it("issues a 6-digit code, stores it in redis, and emails it", async () => {
    const addr = email(path === "/auth/magic-generate" ? "app" : "space");
    const res = await request(app.getHttpServer()).post(path).send({ email: addr }).expect(200);
    expect(res.body).toEqual({ key: `magic_${addr}` });

    expect(mailerSend).toHaveBeenCalledTimes(1);
    const mail = mailerSend.mock.calls[0][0];
    expect(mail.to).toBe(addr);

    const stored = JSON.parse((await redis.get(`magic_${addr}`))!);
    expect(stored.token).toMatch(/^\d{6}$/);
    expect(mail.html).toContain(stored.token);
  });

  it("returns 400 EMAIL_REQUIRED when email is missing", async () => {
    const res = await request(app.getHttpServer()).post(path).send({}).expect(400);
    expect(res.body.error_message).toBe("EMAIL_REQUIRED");
    expect(res.body.error_code).toBeDefined();
    expect(mailerSend).not.toHaveBeenCalled();
  });
});

describe("ENABLE_MAGIC_LINK_LOGIN gate", () => {
  it("returns 400 MAGIC_LINK_LOGIN_DISABLED when the config row is off", async () => {
    await setConfig("ENABLE_MAGIC_LINK_LOGIN", "0");
    try {
      const res = await request(app.getHttpServer())
        .post("/auth/magic-generate")
        .send({ email: email("disabled") })
        .expect(400);
      expect(res.body.error_code).toBe(String(AUTHENTICATION_ERROR_CODES.MAGIC_LINK_LOGIN_DISABLED));
      expect(res.body.error_message).toBe("MAGIC_LINK_LOGIN_DISABLED");
      expect(mailerSend).not.toHaveBeenCalled();
    } finally {
      await setConfig("ENABLE_MAGIC_LINK_LOGIN", "1");
    }
  });

  // Input validation runs ahead of the gate (matching Django, which validates the email before
  // constructing MagicCodeProvider) -- so a malformed request fails EMAIL_REQUIRED even with the
  // gate off, instead of leaking MAGIC_LINK_LOGIN_DISABLED first.
  it("returns 400 EMAIL_REQUIRED (not the gate error) when email is missing and the gate is off", async () => {
    await setConfig("ENABLE_MAGIC_LINK_LOGIN", "0");
    try {
      const res = await request(app.getHttpServer()).post("/auth/magic-generate").send({}).expect(400);
      expect(res.body.error_message).toBe("EMAIL_REQUIRED");
      expect(mailerSend).not.toHaveBeenCalled();
    } finally {
      await setConfig("ENABLE_MAGIC_LINK_LOGIN", "1");
    }
  });
});
