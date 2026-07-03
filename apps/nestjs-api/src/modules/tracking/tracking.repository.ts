import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { workspaces } from "../../infra/database/schema";
import { issueLinks, userRecentVisits, type IssueLink } from "./tracking.schema";

const RECENT_LIMIT = 20;

@Injectable()
export class TrackingRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async workspaceIdBySlug(slug: string): Promise<string | null> {
    const [row] = await this.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    return row?.id ?? null;
  }

  /** recent_visited_task: touch-or-create, then keep only the latest RECENT_LIMIT per user+workspace. */
  async upsertRecentVisit(entityName: string, entityIdentifier: string, userId: string, workspaceId: string, projectId: string | null): Promise<void> {
    const existing = await this.db
      .select({ id: userRecentVisits.id })
      .from(userRecentVisits)
      .where(
        and(
          eq(userRecentVisits.entityName, entityName),
          eq(userRecentVisits.entityIdentifier, entityIdentifier),
          eq(userRecentVisits.userId, userId),
          eq(userRecentVisits.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await this.db.update(userRecentVisits).set({ visitedAt: new Date() }).where(eq(userRecentVisits.id, existing[0].id));
    } else {
      await this.db.insert(userRecentVisits).values({ entityName, entityIdentifier, userId, workspaceId, projectId, visitedAt: new Date() });
    }

    await this.db.execute(
      sql`DELETE FROM user_recent_visits WHERE user_id = ${userId} AND workspace_id = ${workspaceId} AND id NOT IN (
            SELECT id FROM user_recent_visits WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
            ORDER BY visited_at DESC LIMIT ${RECENT_LIMIT}
          )`,
    );
  }

  async findLink(linkId: string): Promise<IssueLink | null> {
    const [row] = await this.db.select().from(issueLinks).where(eq(issueLinks.id, linkId)).limit(1);
    return row ?? null;
  }

  async updateLinkTitle(linkId: string, title: string, metadata: Record<string, unknown>): Promise<void> {
    await this.db.update(issueLinks).set({ title, metadata }).where(eq(issueLinks.id, linkId));
  }
}
