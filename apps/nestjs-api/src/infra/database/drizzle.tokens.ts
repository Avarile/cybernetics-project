import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * DI tokens + the Database type, split out from `drizzle.module.ts` so services that
 * `@Inject(DRIZZLE)` (e.g. InstanceBootstrapService, AdminSeedService) can import them
 * without a module <-> service circular import (DrizzleModule's providers array needs
 * the service classes; the services need these tokens).
 */
export const DRIZZLE = Symbol("DRIZZLE");
export const DRIZZLE_RO = Symbol("DRIZZLE_RO");

export type Database = NodePgDatabase<typeof schema>;
