import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/infra/database/schema";
import { ConfigService } from "../src/infra/config/config.service";
import { AdminSeedService } from "../src/infra/database/admin-seed.service";
import { InstanceBootstrapService } from "../src/infra/database/instance-bootstrap.service";
import { CryptoService } from "../src/infra/config/crypto.service";
import { verifyDjangoPassword } from "../src/infra/auth/django-password";

describe("AdminSeedService", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  const cfg = new ConfigService();
  const crypto = new CryptoService(cfg);
  crypto.onModuleInit();

  beforeAll(async () => {
    process.env.INSTANCE_ADMIN_EMAIL = "admin@example.com";
    process.env.INSTANCE_ADMIN_PASSWORD = "Sup3rSecret!";
    await pool.query("DELETE FROM instance_admins");
    await pool.query("DELETE FROM profiles");
    await pool.query("DELETE FROM users WHERE email='admin@example.com'");
    await pool.query("DELETE FROM instances");
    await new InstanceBootstrapService(db as any, crypto, cfg).run();
  });
  afterAll(() => pool.end());

  it("creates user+profile+admin, sets is_setup_done, hashes Django-compatibly, idempotent", async () => {
    const svc = new AdminSeedService(db as any, cfg);
    await svc.run();
    await svc.run(); // second run is a no-op (admin exists)
    const u = await pool.query("SELECT password FROM users WHERE email='admin@example.com'");
    expect(u.rowCount).toBe(1);
    expect(verifyDjangoPassword("Sup3rSecret!", u.rows[0].password)).toBe(true);
    const p = await pool.query("SELECT count(*)::int n FROM profiles");
    expect(p.rows[0].n).toBe(1);
    const a = await pool.query("SELECT count(*)::int n FROM instance_admins");
    expect(a.rows[0].n).toBe(1);
    const inst = await pool.query("SELECT is_setup_done FROM instances");
    expect(inst.rows[0].is_setup_done).toBe(true);
  });
});
