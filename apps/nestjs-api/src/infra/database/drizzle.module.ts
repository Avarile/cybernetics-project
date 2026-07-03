import { Global, Module } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { DRIZZLE, DRIZZLE_RO, type Database } from "./drizzle.tokens";
import { InstanceBootstrapService } from "./instance-bootstrap.service";
import { AdminSeedService } from "./admin-seed.service";

// Re-exported for the many call sites that do `import { DRIZZLE, type Database } from ".../drizzle.module"`.
export { DRIZZLE, DRIZZLE_RO, type Database } from "./drizzle.tokens";

function makeDb(url: string, max: number): Database {
  // pg Pool connects lazily on first query, so the module initialises without a live DB.
  const pool = new Pool({ connectionString: url, max });
  return drizzle(pool, { schema });
}

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): Database =>
        makeDb(cfg.getOrThrow<string>("DATABASE_URL"), Number(cfg.get("PG_POOL_MAX", 20))),
    },
    {
      provide: DRIZZLE_RO,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): Database =>
        makeDb(
          cfg.get<string>("DATABASE_READ_REPLICA_URL") || cfg.getOrThrow<string>("DATABASE_URL"),
          Number(cfg.get("PG_POOL_MAX", 20)),
        ),
    },
    InstanceBootstrapService,
    AdminSeedService,
  ],
  exports: [DRIZZLE, DRIZZLE_RO, InstanceBootstrapService, AdminSeedService],
})
export class DrizzleModule {}
