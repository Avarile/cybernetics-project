import "dotenv/config";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import { AppModule } from "./app.module";
import { MigrationRunner } from "./infra/database/migration.runner";
import { InstanceBootstrapService } from "./infra/database/instance-bootstrap.service";
import { AdminSeedService } from "./infra/database/admin-seed.service";

// RUN MODE 4 — one-shot DB bootstrap CLI: apply migrations, register + configure the
// instance, seed the first instance admin. Idempotent; safe to re-run (e.g. on every deploy).
async function main(): Promise<void> {
  const log = new Logger("db-init");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await new MigrationRunner(pool).run();
  } finally {
    await pool.end();
  }
  log.log("migrations applied");

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["log", "warn", "error"] });
  try {
    await app.get(InstanceBootstrapService).run();
    await app.get(AdminSeedService).run();
    log.log("db:init complete");
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    new Logger("db-init").error(e);
    process.exit(1);
  });
