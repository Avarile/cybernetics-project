// Env must be set before anything touches the DB.
process.env.DATABASE_URL ??= "postgresql://plane:plane@localhost:5433/plane_test";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../src/infra/database/migration.runner";

describe("MigrationRunner", () => {
  it("applies committed migrations and records them in __drizzle_migrations", async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const runner = new MigrationRunner(pool);
    await runner.run();
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
    );
    expect(rows[0].n).toBeGreaterThan(0);
    await pool.end();
  });
});
