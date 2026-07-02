import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ROLE } from "../../infra/rbac/roles";
import { stripHtml } from "../../shared/strip-html";
import type { CreatePageDto, PageAccessDto, UpdatePageDto } from "./dto/page.dto";
import { PageRepository, type PageSummary } from "./page.repository";
import { PAGE_ACCESS, type Page } from "./page.schema";
import { serializePage, serializePageDetail, type PageDetailDTO, type PageDTO } from "./page.serializer";

const OWNED_BY_ERROR = "Access cannot be updated since this page is owned by someone else";
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

// Detail response also carries issue_ids (from PageLog) — PageLog/page transactions are deferred.
export interface PageRetrieveDTO extends PageDetailDTO {
  issue_ids: string[];
}

@Injectable()
export class PageService {
  constructor(private readonly repo: PageRepository) {}

  private async detail(page: Page): Promise<PageDetailDTO> {
    const ann = await this.repo.annotate([page.id]);
    return serializePageDetail(page, ann.get(page.id)!);
  }

  /** _has_private_page_action_access: only the owner may act on a private page. */
  private assertActionAccess(page: Page, userId: string): void {
    if (page.ownedBy !== userId && page.access === PAGE_ACCESS.PRIVATE) {
      throw new ForbiddenException({ error: "You don't have the required permissions." });
    }
  }

  private async isOwnerOrAdmin(page: Page, userId: string, projectId: string): Promise<boolean> {
    if (page.ownedBy === userId) return true;
    const role = await this.repo.projectMemberRole(projectId, userId);
    return role === ROLE.ADMIN;
  }

  async create(projectId: string, ownedById: string, dto: CreatePageDto): Promise<PageDetailDTO> {
    try {
      const page = await this.repo.createPage(projectId, {
        ownedById,
        name: dto.name,
        access: dto.access,
        color: dto.color,
        parentId: dto.parent,
        isLocked: dto.is_locked,
        viewProps: dto.view_props,
        logoProps: dto.logo_props,
        labels: dto.labels,
        descriptionHtml: dto.description_html,
        descriptionJson: dto.description_json,
        descriptionBinary: dto.description_binary ? Buffer.from(dto.description_binary, "base64") : null,
      });
      // TODO(phase2): page_transaction.delay(new_description_html, old=None, page_id)
      return this.detail(page);
    } catch (err) {
      // e.g. the project_pages (project_id, page_id) partial-unique constraint.
      if (isUniqueViolation(err)) throw new BadRequestException({ error: "The page already exists" });
      throw err;
    }
  }

  async list(projectId: string, userId: string): Promise<PageDTO[]> {
    // TODO(phase2): guest_view_all_features restriction (needs projects.guest_view_all_features column)
    const rows = await this.repo.listVisible(projectId, userId, false);
    const ann = await this.repo.annotate(rows.map((r) => r.id));
    return rows.map((r) => serializePage(r, ann.get(r.id)!));
  }

  summary(projectId: string, userId: string): Promise<PageSummary> {
    // TODO(phase2): guest_view_all_features restriction
    return this.repo.summary(projectId, userId, false);
  }

  async retrieve(projectId: string, id: string, userId: string): Promise<PageRetrieveDTO> {
    const page = await this.repo.findVisible(projectId, id, userId);
    if (!page) throw new NotFoundException({ error: "Page not found" });
    // TODO(phase2): recent_visited_task.delay(...) on retrieve
    const detail = await this.detail(page);
    return { ...detail, issue_ids: [] }; // TODO(phase2): PageLog issue_ids
  }

  async update(projectId: string, id: string, userId: string, dto: UpdatePageDto): Promise<PageDetailDTO> {
    const page = await this.repo.findInProject(projectId, id);
    if (!page) throw new BadRequestException({ error: OWNED_BY_ERROR });
    this.assertActionAccess(page, userId);

    if (page.isLocked) throw new BadRequestException({ error: "Page is locked" });

    if (dto.parent) {
      const parent = await this.repo.findInProject(projectId, dto.parent);
      if (!parent) throw new BadRequestException({ error: OWNED_BY_ERROR });
    }

    // Only the owner may change access.
    if (dto.access !== undefined && dto.access !== page.access && page.ownedBy !== userId) {
      throw new BadRequestException({ error: OWNED_BY_ERROR });
    }

    const patch: Partial<Page> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.access !== undefined) patch.access = dto.access as Page["access"];
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.parent !== undefined) patch.parentId = dto.parent;
    if (dto.is_locked !== undefined) patch.isLocked = dto.is_locked;
    if (dto.view_props !== undefined) patch.viewProps = dto.view_props;
    if (dto.logo_props !== undefined) patch.logoProps = dto.logo_props;
    if (dto.description_json !== undefined) patch.descriptionJson = dto.description_json;
    if (dto.description_html !== undefined) {
      patch.descriptionHtml = dto.description_html;
      patch.descriptionStripped = stripHtml(dto.description_html);
    }

    if (dto.labels !== undefined) await this.repo.setLabels(page.id, page.workspaceId, dto.labels);

    const updated = await this.repo.updatePage(id, patch);
    // TODO(phase2): page_transaction.delay on description_html change
    return this.detail(updated ?? page);
  }

  async destroy(projectId: string, id: string, userId: string): Promise<void> {
    const page = await this.repo.findInProject(projectId, id);
    if (!page) throw new NotFoundException("The required object does not exist.");
    this.assertActionAccess(page, userId);

    if (page.archivedAt === null) {
      throw new BadRequestException({ error: "The page should be archived before deleting" });
    }
    if (!(await this.isOwnerOrAdmin(page, userId, projectId))) {
      throw new ForbiddenException({ error: "Only admin or owner can delete the page" });
    }
    // TODO(phase2): detach children (sub-page trees) + purge favorites/recent-visits
    await this.repo.softDelete(id);
  }

  async archive(projectId: string, id: string, userId: string): Promise<{ archived_at: string }> {
    const page = await this.repo.findInProject(projectId, id);
    if (!page) throw new NotFoundException("The required object does not exist.");
    this.assertActionAccess(page, userId);
    if (!(await this.isOwnerOrAdmin(page, userId, projectId))) {
      throw new BadRequestException({ error: "Only the owner or admin can archive the page" });
    }
    const archivedAt = new Date().toISOString().slice(0, 10);
    // TODO(phase2): recursively archive descendants (WITH RECURSIVE) + purge favorites
    await this.repo.updatePage(id, { archivedAt });
    return { archived_at: archivedAt };
  }

  async unarchive(projectId: string, id: string, userId: string): Promise<void> {
    const page = await this.repo.findInProject(projectId, id);
    if (!page) throw new NotFoundException("The required object does not exist.");
    this.assertActionAccess(page, userId);
    if (!(await this.isOwnerOrAdmin(page, userId, projectId))) {
      throw new BadRequestException({ error: "Only the owner or admin can un archive the page" });
    }
    // TODO(phase2): detach from archived parent + recursively unarchive descendants
    await this.repo.updatePage(id, { archivedAt: null });
  }

  async lock(projectId: string, id: string, userId: string): Promise<void> {
    const page = await this.repo.findInProject(projectId, id);
    if (!page) throw new NotFoundException("The required object does not exist.");
    this.assertActionAccess(page, userId);
    await this.repo.updatePage(id, { isLocked: true });
  }

  async unlock(projectId: string, id: string, userId: string): Promise<void> {
    const page = await this.repo.findInProject(projectId, id);
    if (!page) throw new NotFoundException("The required object does not exist.");
    this.assertActionAccess(page, userId);
    await this.repo.updatePage(id, { isLocked: false });
  }

  async access(projectId: string, id: string, userId: string, dto: PageAccessDto): Promise<void> {
    const access = dto.access ?? PAGE_ACCESS.PUBLIC;
    const page = await this.repo.findInProject(projectId, id);
    if (!page) throw new NotFoundException("The required object does not exist.");
    this.assertActionAccess(page, userId);
    if (access !== page.access && page.ownedBy !== userId) {
      throw new BadRequestException({ error: OWNED_BY_ERROR });
    }
    await this.repo.updatePage(id, { access: access as Page["access"] });
  }
}
