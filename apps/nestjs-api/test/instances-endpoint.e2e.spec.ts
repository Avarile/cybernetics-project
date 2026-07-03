// Env must be set before AppModule providers instantiate.
process.env.DATABASE_URL ??= "postgresql://plane:plane@localhost:5433/plane_test";
process.env.SECRET_KEY ??= "e2e-test-secret-key";
process.env.REDIS_URL ??= "redis://localhost:6379/0";
process.env.AMQP_URL ??= "amqp://guest:guest@localhost:5672/";
process.env.INSTANCE_ADMIN_EMAIL ??= "admin@example.com";
process.env.INSTANCE_ADMIN_PASSWORD ??= "Sup3rSecret!";
process.env.SEED_ON_BOOT = "0";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AdminSeedService } from "../src/infra/database/admin-seed.service";
import { DRIZZLE, type Database } from "../src/infra/database/drizzle.module";
import { InstanceBootstrapService } from "../src/infra/database/instance-bootstrap.service";

// End-to-end proof that boots the real Nest app and drives the bootstrap + admin seed the same way
// main.ts does (SEED_ON_BOOT), then hits the actual HTTP endpoint the web app's auth-root.tsx
// bootstraps from. This is the condition that makes it render the sign-in form instead of
// "No authentication methods available".
describe("GET /api/instances", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const db = app.get<Database>(DRIZZLE);

    // Other e2e spec files share this DB and aren't mutually isolated: instance-bootstrap.e2e.spec.ts
    // deletes `instances` without also clearing `instance_admins` (no FK between them), which orphans
    // the admin row and makes AdminSeedService.run() see "an admin exists" and skip forever, leaving
    // the fresh instance's is_setup_done stuck at false. Reset to a clean slate so this test proves the
    // real bootstrap->seed->serve flow regardless of suite run order.
    await db.execute(sql`DELETE FROM instance_admins`);
    await db.execute(sql`DELETE FROM profiles`);
    await db.execute(sql`DELETE FROM users WHERE email = ${process.env.INSTANCE_ADMIN_EMAIL}`);
    await db.execute(sql`DELETE FROM instances`);
    await db.execute(sql`DELETE FROM instance_configurations`);

    await app.get(InstanceBootstrapService).run();
    await app.get(AdminSeedService).run();
  });

  afterAll(() => app.close());

  it("returns config with email/password enabled and is_setup_done=true", async () => {
    const res = await request(app.getHttpServer()).get("/api/instances").expect(200);
    expect(res.body.config.is_email_password_enabled).toBe(true);
    expect(res.body.instance.is_setup_done).toBe(true);
  });
});
