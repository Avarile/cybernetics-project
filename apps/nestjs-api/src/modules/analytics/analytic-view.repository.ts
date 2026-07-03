import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { RequestContextService } from "../../infra/context/request-context";
import { BaseRepository } from "../../infra/database/base.repository";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { workspaces } from "../../infra/database/schema";
import { analyticViews, type AnalyticView } from "./analytics.schema";

@Injectable()
export class AnalyticViewRepository extends BaseRepository<typeof analyticViews> {
  constructor(@Inject(DRIZZLE) db: Database, ctx: RequestContextService) {
    super(db, analyticViews, ctx);
  }

  async workspaceIdBySlug(slug: string): Promise<string | null> {
    const [w] = await this.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    return w?.id ?? null;
  }

  listByWorkspace(workspaceId: string): Promise<AnalyticView[]> {
    return this.db
      .select()
      .from(analyticViews)
      .where(and(eq(analyticViews.workspaceId, workspaceId), isNull(analyticViews.deletedAt)))
      .orderBy(desc(analyticViews.createdAt)) as unknown as Promise<AnalyticView[]>;
  }

  async findInWorkspace(id: string, workspaceId: string): Promise<AnalyticView | null> {
    const [row] = await this.db
      .select()
      .from(analyticViews)
      .where(and(eq(analyticViews.id, id), eq(analyticViews.workspaceId, workspaceId), isNull(analyticViews.deletedAt)))
      .limit(1);
    return row ?? null;
  }
}

/** AnalyticViewSerializer(fields="__all__"). */
export function serializeAnalyticView(v: AnalyticView) {
  return {
    id: v.id,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
    created_by: v.createdBy,
    updated_by: v.updatedBy,
    workspace: v.workspaceId,
    name: v.name,
    description: v.description ?? "",
    query: v.query ?? {},
    query_dict: v.queryDict ?? {},
  };
}
