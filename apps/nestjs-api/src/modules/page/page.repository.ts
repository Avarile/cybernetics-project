import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { RequestContextService } from "../../infra/context/request-context";
import { BaseRepository } from "../../infra/database/base.repository";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { projectMembers, projects } from "../../infra/database/schema";
import { stripHtml } from "../../shared/strip-html";
import { PAGE_ACCESS, pageLabels, pages, projectPages, type Page } from "./page.schema";
import type { PageAnnotations } from "./page.serializer";

export interface CreatePageInput {
  ownedById: string;
  name?: string;
  access?: number;
  color?: string;
  parentId?: string | null;
  isLocked?: boolean;
  viewProps?: Record<string, unknown>;
  logoProps?: Record<string, unknown>;
  descriptionHtml?: string;
  descriptionJson?: Record<string, unknown>;
  descriptionBinary?: Buffer | null;
  labels?: string[];
}

export interface PageSummary {
  public_pages: number;
  private_pages: number;
  archived_pages: number;
}

@Injectable()
export class PageRepository extends BaseRepository<typeof pages> {
  constructor(@Inject(DRIZZLE) db: Database, ctx: RequestContextService) {
    super(db, pages, ctx);
  }

  private inProject(projectId: string) {
    return exists(
      this.db
        .select({ x: sql`1` })
        .from(projectPages)
        .where(
          and(
            eq(projectPages.pageId, pages.id),
            eq(projectPages.projectId, projectId),
            isNull(projectPages.deletedAt),
          ),
        ),
    );
  }

  /** Visible = owner OR public. Mirrors get_queryset filter `Q(owned_by=user) | Q(access=0)`. */
  private visible(userId: string) {
    return or(eq(pages.ownedBy, userId), eq(pages.access, PAGE_ACCESS.PUBLIC));
  }

  /** Reproduces PageSerializer.create(): page + project_page + page_labels in one transaction. */
  async createPage(projectId: string, input: CreatePageInput): Promise<Page> {
    const userId = this.currentUserId();
    return this.db.transaction(async (tx) => {
      const [proj] = await tx
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      const workspaceId = proj.workspaceId;
      const html = input.descriptionHtml ?? "<p></p>";

      const [page] = await tx
        .insert(pages)
        .values({
          workspaceId,
          name: input.name ?? "",
          ownedBy: input.ownedById,
          access: (input.access ?? PAGE_ACCESS.PUBLIC) as Page["access"],
          color: input.color ?? "",
          parentId: input.parentId ?? null,
          isLocked: input.isLocked ?? false,
          viewProps: input.viewProps ?? { full_width: false },
          logoProps: input.logoProps ?? {},
          descriptionJson: input.descriptionJson ?? {},
          descriptionHtml: html,
          descriptionStripped: stripHtml(html),
          descriptionBinary: input.descriptionBinary ?? null,
          createdBy: userId,
          updatedBy: null,
        })
        .returning();

      await tx.insert(projectPages).values({ workspaceId, projectId, pageId: page.id, createdBy: userId });

      if (input.labels?.length) {
        await tx.insert(pageLabels).values(
          input.labels.map((labelId) => ({ workspaceId, pageId: page.id, labelId, createdBy: userId })),
        );
      }
      return page;
    });
  }

  /** get_queryset()-style fetch (visibility + top-level only) — used by list/retrieve/summary. */
  listVisible(projectId: string, userId: string, onlyOwned: boolean): Promise<Page[]> {
    return this.db
      .select()
      .from(pages)
      .where(
        and(
          isNull(pages.deletedAt),
          isNull(pages.parentId),
          onlyOwned ? eq(pages.ownedBy, userId) : this.visible(userId),
          this.inProject(projectId),
        ),
      )
      .orderBy(desc(pages.createdAt));
  }

  async findVisible(projectId: string, id: string, userId: string): Promise<Page | null> {
    const rows = await this.db
      .select()
      .from(pages)
      .where(
        and(
          isNull(pages.deletedAt),
          isNull(pages.parentId),
          eq(pages.id, id),
          this.visible(userId),
          this.inProject(projectId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Object-action fetch (no visibility/parent filter) — mirrors `Page.objects.get(pk, workspace, projects, project_pages__deleted_at__isnull)`. */
  async findInProject(projectId: string, id: string): Promise<Page | null> {
    const rows = await this.db
      .select()
      .from(pages)
      .where(and(isNull(pages.deletedAt), eq(pages.id, id), this.inProject(projectId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async summary(projectId: string, userId: string, onlyOwned: boolean): Promise<PageSummary> {
    const [row] = await this.db
      .select({
        public_pages: sql<number>`count(*) filter (where ${pages.access} = ${PAGE_ACCESS.PUBLIC} and ${pages.archivedAt} is null)::int`,
        private_pages: sql<number>`count(*) filter (where ${pages.access} = ${PAGE_ACCESS.PRIVATE} and ${pages.archivedAt} is null)::int`,
        archived_pages: sql<number>`count(*) filter (where ${pages.archivedAt} is not null)::int`,
      })
      .from(pages)
      .where(
        and(
          isNull(pages.deletedAt),
          isNull(pages.parentId),
          onlyOwned ? eq(pages.ownedBy, userId) : this.visible(userId),
          this.inProject(projectId),
        ),
      );
    return row ?? { public_pages: 0, private_pages: 0, archived_pages: 0 };
  }

  /** Batch-load label_ids / project_ids (is_favorite deferred — favorites not ported). */
  async annotate(pageIds: string[]): Promise<Map<string, PageAnnotations>> {
    const result = new Map<string, PageAnnotations>();
    for (const id of pageIds) result.set(id, { is_favorite: false, label_ids: [], project_ids: [] });
    if (pageIds.length === 0) return result;

    const labelRows = await this.db
      .select({ pageId: pageLabels.pageId, labelId: pageLabels.labelId })
      .from(pageLabels)
      .where(and(inArray(pageLabels.pageId, pageIds), isNull(pageLabels.deletedAt)));
    for (const r of labelRows) result.get(r.pageId)?.label_ids.push(r.labelId);

    const projectRows = await this.db
      .select({ pageId: projectPages.pageId, projectId: projectPages.projectId })
      .from(projectPages)
      .where(and(inArray(projectPages.pageId, pageIds), isNull(projectPages.deletedAt)));
    for (const r of projectRows) result.get(r.pageId)?.project_ids.push(r.projectId);

    return result;
  }

  /** Active project-membership role of the user (SET_NULL semantics: null when not a member). */
  async projectMemberRole(projectId: string, userId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.memberId, userId), eq(projectMembers.isActive, true)))
      .limit(1);
    return row?.role ?? null;
  }

  async updatePage(id: string, patch: Partial<Page>): Promise<Page | null> {
    const rows = await this.db
      .update(pages)
      .set({ ...patch, updatedBy: this.currentUserId() })
      .where(eq(pages.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /** Replace the label set (Django deletes all PageLabel for the page, then bulk_creates). */
  async setLabels(pageId: string, workspaceId: string, labelIds: string[]): Promise<void> {
    const userId = this.currentUserId();
    await this.db.transaction(async (tx) => {
      await tx.delete(pageLabels).where(eq(pageLabels.pageId, pageId));
      if (labelIds.length) {
        await tx.insert(pageLabels).values(
          labelIds.map((labelId) => ({ workspaceId, pageId, labelId, createdBy: userId })),
        );
      }
    });
  }
}
