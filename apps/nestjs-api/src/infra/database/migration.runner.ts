import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { join } from "path";

/** Applies committed Drizzle migrations. Idempotent: drizzle tracks applied migrations. */
export class MigrationRunner {
  constructor(private readonly pool: Pool) {}

  async run(migrationsFolder = join(__dirname, "../../../drizzle")): Promise<void> {
    const db = drizzle(this.pool);
    await migrate(db, { migrationsFolder });
  }
}
