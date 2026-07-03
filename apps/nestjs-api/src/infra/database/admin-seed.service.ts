import { randomUUID } from "crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "./drizzle.module";
import { instances, users, profiles, instanceAdmins } from "./schema";
import { ConfigService } from "../config/config.service";
import { makeDjangoPassword } from "../auth/django-password";

const ADVISORY_LOCK = 4915;

/** Mirrors Django's god-mode signup (plane/license/api/views/instance.py InstanceAdminEndpoint / admin.py:236-260):
 * the headless first-admin seed that flips is_setup_done so the web app renders sign-in instead of "Instance not ready". */
@Injectable()
export class AdminSeedService {
  private readonly log = new Logger(AdminSeedService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService
  ) {}

  async run(): Promise<void> {
    const email = this.config.get<string>("INSTANCE_ADMIN_EMAIL");
    const password = this.config.get<string>("INSTANCE_ADMIN_PASSWORD");
    if (!email || !password) {
      throw new Error("INSTANCE_ADMIN_EMAIL and INSTANCE_ADMIN_PASSWORD are required for db:init");
    }
    const firstName = this.config.get<string>("INSTANCE_ADMIN_FIRST_NAME") ?? "";
    const lastName = this.config.get<string>("INSTANCE_ADMIN_LAST_NAME") ?? "";
    const company = this.config.get<string>("INSTANCE_ADMIN_COMPANY") ?? "Plane Community Edition";
    const telemetry = this.config.get<string>("INSTANCE_ADMIN_TELEMETRY") !== "0";

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK})`);
      const [instance] = await tx.select().from(instances).limit(1);
      if (!instance) throw new Error("No instance row; run InstanceBootstrapService first");

      const [admin] = await tx.select().from(instanceAdmins).limit(1);
      if (instance.isSetupDone || admin) {
        this.log.log("instance admin already exists; skipping");
        return;
      }

      const now = new Date();
      const userId = randomUUID();
      await tx.insert(users).values({
        id: userId,
        email,
        username: randomUUID().replace(/-/g, ""),
        password: makeDjangoPassword(password),
        firstName,
        lastName,
        isPasswordAutoset: false,
        isActive: true,
        lastActive: now,
        lastLoginTime: now,
        lastLoginMedium: "email",
        tokenUpdatedAt: now,
        dateJoined: now,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(profiles).values({ userId, companyName: company });
      await tx.insert(instanceAdmins).values({ userId, instanceId: instance.id, role: 20 });
      await tx.update(instances).set({ isSetupDone: true, instanceName: company, isTelemetryEnabled: telemetry });
    });
    this.log.log("instance admin seeded; is_setup_done=true");
  }
}
