import { readdirSync } from "fs";
import { join } from "path";
import { Logger } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Applies committed Drizzle migrations. Idempotent: drizzle tracks applied migrations. */
export class MigrationRunner {
  private readonly log = new Logger(MigrationRunner.name);

  constructor(private readonly pool: Pool) {}

  async run(migrationsFolder = join(__dirname, "../../../drizzle")): Promise<void> {
    const count = readdirSync(migrationsFolder).filter((f) => f.endsWith(".sql")).length;
    if (count === 0) {
      throw new Error(`No migrations found in ${migrationsFolder} — did the drizzle/ folder get shipped?`);
    }
    this.log.log(`applying migrations from ${migrationsFolder} (${count} files)`);
    const db = drizzle(this.pool);
    await migrate(db, { migrationsFolder });
  }
}
