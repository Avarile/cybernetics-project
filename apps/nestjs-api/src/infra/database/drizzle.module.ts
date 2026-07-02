import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const DRIZZLE = Symbol("DRIZZLE");
export const DRIZZLE_RO = Symbol("DRIZZLE_RO");

export type Database = PostgresJsDatabase<typeof schema>;

function makeDb(url: string, max: number): Database {
  // postgres-js connects lazily on first query, so the module initialises without a live DB.
  const client = postgres(url, { max, prepare: false });
  return drizzle(client, { schema });
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
  ],
  exports: [DRIZZLE, DRIZZLE_RO],
})
export class DrizzleModule {}
