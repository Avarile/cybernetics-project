import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { and, eq, gt } from "drizzle-orm";
import { DRIZZLE, type Database } from "../database/drizzle.module";
import { sessions, users, type SessionRow, type User } from "../database/schema";
import { buildSessionPayload, djangoDumps, newSessionKey } from "./session.crypto";

export interface ResolvedSession {
  user: User;
  session: SessionRow;
}

/**
 * Drop-in Django session store (plane/db/models/session.py).
 * READ: cookie value is the raw session_key -> row -> denormalized user_id -> user (no crypto).
 * WRITE: replicate Django's signed session_data (shared SECRET_KEY) so Django can also read it.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  async resolve(sessionKey: string): Promise<ResolvedSession | null> {
    if (!sessionKey) return null;
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.sessionKey, sessionKey), gt(sessions.expireDate, new Date())))
      .limit(1);
    if (!row?.userId) return null;

    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, row.userId), eq(users.isActive, true)))
      .limit(1);
    if (!user) return null;

    return { user, session: row };
  }

  /** Create a session row + return the cookie key + max-age. isAdmin => admin cookie age (1h). */
  async create(
    user: Pick<User, "id" | "password">,
    deviceInfo: Record<string, unknown> | null,
    isAdmin: boolean,
  ): Promise<{ key: string; maxAge: number }> {
    const secret = this.config.getOrThrow<string>("SECRET_KEY");
    const key = newSessionKey();
    const maxAge = isAdmin
      ? Number(this.config.get("ADMIN_SESSION_COOKIE_AGE", 3600))
      : Number(this.config.get("SESSION_COOKIE_AGE", 604800));

    const payload = buildSessionPayload(String(user.id), user.password ?? "", secret, deviceInfo);
    await this.db.insert(sessions).values({
      sessionKey: key,
      sessionData: djangoDumps(payload, secret),
      userId: String(user.id),
      deviceInfo,
      expireDate: new Date(Date.now() + maxAge * 1000),
    });
    return { key, maxAge };
  }

  async destroy(sessionKey: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.sessionKey, sessionKey));
  }
}
