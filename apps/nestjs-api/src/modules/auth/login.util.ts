import { eq } from "drizzle-orm";
import type { Request } from "express";
import type { Database } from "../../infra/database/drizzle.module";
import { users } from "../../infra/database/schema";

/**
 * plane/authentication/adapter/base.py::Adapter.save_user_data -- run on every successful
 * sign-in AND sign-up, before the session is issued. Reactivates a never-logged-out inactive
 * account (`is_active=true`, matching GHSA-rmmf-rj2q-3rrg's fix); an explicitly deactivated
 * account (last_logout_time set) never reaches here -- EmailProvider rejects it earlier.
 */
export async function recordLogin(db: Database, userId: string, req: Request): Promise<void> {
  const now = new Date();
  const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
  await db
    .update(users)
    .set({
      isActive: true,
      lastActive: now,
      lastLoginTime: now,
      lastLoginIp: ipAddress,
      lastLoginMedium: "email",
      lastLoginUagent: (req.headers["user-agent"] as string) || "",
      tokenUpdatedAt: now,
    })
    .where(eq(users.id, userId));
}
