import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/infra/database/schema";
import { CryptoService } from "../src/infra/config/crypto.service";
import { ConfigService } from "../src/infra/config/config.service";
import { InstanceBootstrapService } from "../src/infra/database/instance-bootstrap.service";

describe("InstanceBootstrapService", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  const cfg = new ConfigService();
  const crypto = new CryptoService(cfg);
  crypto.onModuleInit();
  const svc = new InstanceBootstrapService(db as any, crypto, cfg);

  beforeAll(async () => {
    await pool.query("DELETE FROM instance_configurations");
    await pool.query("DELETE FROM instances");
  });
  afterAll(() => pool.end());

  it("is idempotent: one instance row, one row per key, email/password on", async () => {
    await svc.run();
    await svc.run();
    const inst = await pool.query("SELECT count(*)::int n FROM instances");
    expect(inst.rows[0].n).toBe(1);
    const dup = await pool.query(
      "SELECT key, count(*)::int n FROM instance_configurations GROUP BY key HAVING count(*)>1"
    );
    expect(dup.rowCount).toBe(0);
    const ep = await pool.query("SELECT value FROM instance_configurations WHERE key='ENABLE_EMAIL_PASSWORD'");
    expect(ep.rows[0].value).toBe("1");
    // encrypted empty -> "" (Finding 3); no IS_GOOGLE_ENABLED row (Finding 2)
    const g = await pool.query("SELECT count(*)::int n FROM instance_configurations WHERE key='IS_GOOGLE_ENABLED'");
    expect(g.rows[0].n).toBe(0);
  });
});
