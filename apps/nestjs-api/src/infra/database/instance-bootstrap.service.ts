import { randomBytes, randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "./drizzle.tokens";
import { instances, instanceConfigurations } from "./schema";
import { CryptoService } from "../config/crypto.service";
import { ConfigService } from "../config/config.service";
import { INSTANCE_CONFIG_VARIABLES } from "./instance-config.seed";

const ADVISORY_LOCK = 4915;

/** Mirrors Django's register_instance + configure_instance management commands. */
@Injectable()
export class InstanceBootstrapService {
  private readonly log = new Logger(InstanceBootstrapService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService
  ) {}

  private currentVersion(): string {
    const fromEnv = this.config.get<string>("APP_VERSION");
    if (fromEnv) return fromEnv;
    try {
      const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
      return pkg.version ?? "v0.1.0";
    } catch {
      return "v0.1.0";
    }
  }

  /** Reproduces register_instance.py: create the singleton row, or refresh version/is_test on it. */
  async registerInstance(db: Database = this.db): Promise<void> {
    const [existing] = await db.select().from(instances).limit(1);
    const now = new Date();
    const version = this.currentVersion();
    const isTest = this.config.get<string>("IS_TEST") === "1";
    if (existing) {
      await db
        .update(instances)
        .set({
          lastCheckedAt: now,
          currentVersion: version,
          latestVersion: version,
          isTest,
          edition: "PLANE_COMMUNITY",
        })
        .where(eq(instances.id, existing.id));
      return;
    }
    await db.insert(instances).values({
      instanceName: "Plane Community Edition",
      instanceId: randomBytes(12).toString("hex"),
      currentVersion: version,
      latestVersion: version,
      lastCheckedAt: now,
      isTest,
      edition: "PLANE_COMMUNITY",
    });
  }

  /** Reproduces configure_instance.py's get_or_create loop. Does NOT seed the dead IS_*_ENABLED block. */
  async configureInstance(db: Database = this.db): Promise<void> {
    const now = new Date();
    for (const v of INSTANCE_CONFIG_VARIABLES) {
      const [row] = await db
        .select()
        .from(instanceConfigurations)
        .where(eq(instanceConfigurations.key, v.key))
        .limit(1);
      if (row) continue; // get-or-create: leave existing rows untouched
      const stored = v.isEncrypted ? (v.value ? this.crypto.encrypt(v.value) : "") : (v.value ?? null);
      await db.insert(instanceConfigurations).values({
        id: randomUUID(),
        key: v.key,
        value: stored,
        category: v.category,
        isEncrypted: v.isEncrypted,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async run(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK})`);
      await this.registerInstance(tx);
      await this.configureInstance(tx);
    });
    this.log.log("instance registered + configured");
  }
}
