import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, max, or, type SQL } from "drizzle-orm";
import { RequestContextService } from "../../infra/context/request-context";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { ProjectScopedRepository } from "../../infra/database/project-scoped.repository";
import { workspaces } from "../../infra/database/schema";
import { issueViews, VIEW_ACCESS, type IssueView } from "./view.schema";

@Injectable()
export class ViewRepository extends ProjectScopedRepository<typeof issueViews> {
  constructor(@Inject(DRIZZLE) db: Database, ctx: RequestContextService) {
    super(db, issueViews, ctx);
  }

  /**
   * Django get_queryset visibility gate: Q(owned_by=user) | Q(access=1). Since `access` is read-only
   * and defaults to Public (1), this is effectively "all in-scope views" — kept for faithfulness.
   */
  private visibility(): SQL {
    const userId = this.currentUserId();
    if (userId) return or(eq(issueViews.access, VIEW_ACCESS.PUBLIC), eq(issueViews.ownedBy, userId)) as SQL;
    return eq(issueViews.access, VIEW_ACCESS.PUBLIC);
  }

  async resolveWorkspaceIdBySlug(slug: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  // --- Project-level (IssueViewViewSet). Django orders by (-is_favorite, name); favorites deferred. ---

  listByProject(projectId: string): Promise<IssueView[]> {
    return this.db
      .select()
      .from(issueViews)
      .where(and(isNull(issueViews.deletedAt), eq(issueViews.projectId, projectId), this.visibility()))
      .orderBy(asc(issueViews.name));
  }

  async findInProject(projectId: string, id: string): Promise<IssueView | null> {
    const rows = await this.db
      .select()
      .from(issueViews)
      .where(and(isNull(issueViews.deletedAt), eq(issueViews.projectId, projectId), eq(issueViews.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async maxSortOrderProject(projectId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ largest: max(issueViews.sortOrder) })
      .from(issueViews)
      .where(and(eq(issueViews.projectId, projectId), isNull(issueViews.deletedAt)));
    return row?.largest ?? null;
  }

  // --- Workspace-level (WorkspaceViewViewSet): project IS NULL. Django orders by -created_at. ---

  listByWorkspace(workspaceId: string): Promise<IssueView[]> {
    return this.db
      .select()
      .from(issueViews)
      .where(
        and(
          isNull(issueViews.deletedAt),
          eq(issueViews.workspaceId, workspaceId),
          isNull(issueViews.projectId),
          this.visibility(),
        ),
      )
      .orderBy(desc(issueViews.createdAt));
  }

  async findInWorkspace(workspaceId: string, id: string): Promise<IssueView | null> {
    const rows = await this.db
      .select()
      .from(issueViews)
      .where(
        and(
          isNull(issueViews.deletedAt),
          eq(issueViews.workspaceId, workspaceId),
          isNull(issueViews.projectId),
          eq(issueViews.id, id),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async maxSortOrderWorkspace(workspaceId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ largest: max(issueViews.sortOrder) })
      .from(issueViews)
      .where(and(eq(issueViews.workspaceId, workspaceId), isNull(issueViews.projectId), isNull(issueViews.deletedAt)));
    return row?.largest ?? null;
  }
}
