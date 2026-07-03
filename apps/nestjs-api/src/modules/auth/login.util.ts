import { eq } from "drizzle-orm";
import type { Request } from "express";
import type { Database } from "../../infra/database/drizzle.module";
import { users } from "../../infra/database/schema";

function clientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
}

/**
 * plane/authentication/adapter/base.py::Adapter.save_user_data -- run on every successful
 * sign-in AND sign-up, before the session is issued. Reactivates a never-logged-out inactive
 * account (`is_active=true`, matching GHSA-rmmf-rj2q-3rrg's fix); an explicitly deactivated
 * account (last_logout_time set) never reaches here -- EmailProvider rejects it earlier.
 */
export async function recordLogin(db: Database, userId: string, req: Request): Promise<void> {
  const now = new Date();
  await db
    .update(users)
    .set({
      isActive: true,
      lastActive: now,
      lastLoginTime: now,
      lastLoginIp: clientIp(req),
      lastLoginMedium: "email",
      lastLoginUagent: (req.headers["user-agent"] as string) || "",
      tokenUpdatedAt: now,
    })
    .where(eq(users.id, userId));
}

/**
 * plane/authentication/views/app/signout.py::SignOutAuthEndpoint -- run on every sign-out, for
 * whichever user the destroyed session belonged to. Does NOT touch is_active: sign-out is not
 * deactivation, it only records that this session's owner logged out explicitly (this is what
 * later distinguishes an explicitly-deactivated account from a merely-inactive one in
 * EmailProvider.signIn -- see the recordLogin comment above).
 */
export async function recordLogout(db: Database, userId: string, req: Request): Promise<void> {
  await db
    .update(users)
    .set({ lastLogoutIp: clientIp(req), lastLogoutTime: new Date() })
    .where(eq(users.id, userId));
}
