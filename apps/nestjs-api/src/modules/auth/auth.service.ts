import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { users, type User } from "../../infra/database/schema";
import { verifyDjangoPassword } from "../../infra/auth/django-password";

/**
 * Credential verification against existing Django users. Mirrors the EmailProvider check:
 * case-insensitive email match, active user, PBKDF2 password verification.
 */
@Injectable()
export class AuthService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findActiveUserByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = ${normalized}`, eq(users.isActive, true)))
      .limit(1);
    return user ?? null;
  }

  /** Same lookup, but regardless of is_active -- Django's User.objects.filter(email=...) has no
   * active filter (see check.py/email.py), so callers that need to tell "no such user" apart from
   * "deactivated user" must look this up unfiltered. */
  async findUserByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalized}`)
      .limit(1);
    return user ?? null;
  }

  async verifyCredentials(email: string, password: string): Promise<User | null> {
    const user = await this.findActiveUserByEmail(email);
    if (!user || !user.password) return null;
    return verifyDjangoPassword(password, user.password) ? user : null;
  }
}
