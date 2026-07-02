import { BadRequestException, Injectable } from "@nestjs/common";
import { RequestContextService } from "../../infra/context/request-context";
import type { CreateViewDto, UpdateViewDto } from "./dto/view.dto";
import { defaultDisplayFilters, defaultDisplayProperties, type IssueView } from "./view.schema";
import { ViewRepository } from "./view.repository";
import { serializeView, type ViewDTO } from "./view.serializer";

const NOT_FOUND = "The required object does not exist.";
const LOCKED = "view is locked";
const NOT_OWNER = "Only the owner of the view can update the view";

@Injectable()
export class ViewService {
  constructor(
    private readonly repo: ViewRepository,
    private readonly ctx: RequestContextService,
  ) {}

  // ---------------------------------------------------------------- project-level (IssueViewViewSet)

  async listProject(projectId: string): Promise<ViewDTO[]> {
    const rows = await this.repo.listByProject(projectId);
    return rows.map((v) => serializeView(v));
  }

  async retrieveProject(projectId: string, id: string): Promise<ViewDTO> {
    const view = await this.repo.findInProject(projectId, id);
    if (!view) throw new BadRequestException(NOT_FOUND);
    return serializeView(view);
  }

  async createProject(projectId: string, dto: CreateViewDto): Promise<ViewDTO> {
    const largest = await this.repo.maxSortOrderProject(projectId);
    const sortOrder = largest !== null ? largest + 10000 : 65535;
    const view = await this.repo.create(this.buildInsert({ projectId, workspaceId: undefined }, dto, sortOrder));
    return serializeView(view);
  }

  async updateProject(projectId: string, id: string, dto: UpdateViewDto): Promise<ViewDTO> {
    const existing = await this.repo.findInProject(projectId, id);
    return this.applyUpdate(existing, id, dto);
  }

  async destroyProject(projectId: string, id: string): Promise<void> {
    const view = await this.repo.findInProject(projectId, id);
    if (!view) throw new BadRequestException(NOT_FOUND);
    await this.repo.softDelete(id);
  }

  // ------------------------------------------------------------ workspace-level (WorkspaceViewViewSet)

  async listWorkspace(slug: string): Promise<ViewDTO[]> {
    const workspaceId = await this.workspaceId(slug);
    const rows = await this.repo.listByWorkspace(workspaceId);
    return rows.map((v) => serializeView(v));
  }

  async retrieveWorkspace(slug: string, id: string): Promise<ViewDTO> {
    const workspaceId = await this.workspaceId(slug);
    const view = await this.repo.findInWorkspace(workspaceId, id);
    if (!view) throw new BadRequestException(NOT_FOUND);
    return serializeView(view);
  }

  async createWorkspace(slug: string, dto: CreateViewDto): Promise<ViewDTO> {
    const workspaceId = await this.workspaceId(slug);
    const largest = await this.repo.maxSortOrderWorkspace(workspaceId);
    const sortOrder = largest !== null ? largest + 10000 : 65535;
    const view = await this.repo.create(this.buildInsert({ projectId: null, workspaceId }, dto, sortOrder));
    return serializeView(view);
  }

  async updateWorkspace(slug: string, id: string, dto: UpdateViewDto): Promise<ViewDTO> {
    const workspaceId = await this.workspaceId(slug);
    const existing = await this.repo.findInWorkspace(workspaceId, id);
    return this.applyUpdate(existing, id, dto);
  }

  async destroyWorkspace(slug: string, id: string): Promise<void> {
    const workspaceId = await this.workspaceId(slug);
    const view = await this.repo.findInWorkspace(workspaceId, id);
    if (!view) throw new BadRequestException(NOT_FOUND);
    await this.repo.softDelete(id);
  }

  // --------------------------------------------------------------------------------------- internals

  private async workspaceId(slug: string): Promise<string> {
    const id = await this.repo.resolveWorkspaceIdBySlug(slug);
    if (!id) throw new BadRequestException(NOT_FOUND);
    return id;
  }

  private currentUserId(): string {
    const userId = this.ctx.userId;
    if (!userId) throw new BadRequestException(NOT_FOUND);
    return userId;
  }

  /**
   * Django IssueView.save() / serializer: query = issue_filters(filters, ...) when filters is truthy
   * else {}. issue_filters() (a shared util translating the filter dict into ORM lookup kwargs) is not
   * ported to this domain, so we store the raw filters as a stand-in, preserving the empty/non-empty
   * semantics and round-tripping the data.
   */
  private computeQuery(filters: Record<string, unknown> | null | undefined): Record<string, unknown> {
    return filters && Object.keys(filters).length > 0 ? { ...filters } : {};
  }

  private buildInsert(
    tenancy: { projectId: string | null; workspaceId: string | undefined },
    dto: CreateViewDto,
    sortOrder: number,
  ): IssueView {
    const filters = dto.filters ?? {};
    return {
      projectId: tenancy.projectId,
      workspaceId: tenancy.workspaceId,
      ownedBy: this.currentUserId(),
      name: dto.name,
      description: dto.description ?? "",
      filters,
      query: this.computeQuery(filters),
      displayFilters: dto.display_filters ?? defaultDisplayFilters(),
      displayProperties: dto.display_properties ?? defaultDisplayProperties(),
      richFilters: dto.rich_filters ?? {},
      logoProps: dto.logo_props ?? {},
      sortOrder,
      ...(dto.archived_at !== undefined ? { archivedAt: new Date(dto.archived_at) } : {}),
    } as unknown as IssueView;
  }

  /** Shared partial_update body: lock gate, owner gate, then patch + query recompute (model.save()). */
  private async applyUpdate(existing: IssueView | null, id: string, dto: UpdateViewDto): Promise<ViewDTO> {
    if (!existing) throw new BadRequestException(NOT_FOUND);
    if (existing.isLocked) throw new BadRequestException({ error: LOCKED });
    if (existing.ownedBy !== this.currentUserId()) throw new BadRequestException({ error: NOT_OWNER });

    const patch: Partial<IssueView> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.filters !== undefined) patch.filters = dto.filters;
    if (dto.display_filters !== undefined) patch.displayFilters = dto.display_filters;
    if (dto.display_properties !== undefined) patch.displayProperties = dto.display_properties;
    if (dto.rich_filters !== undefined) patch.richFilters = dto.rich_filters;
    if (dto.logo_props !== undefined) patch.logoProps = dto.logo_props;
    if (dto.sort_order !== undefined) patch.sortOrder = dto.sort_order;
    if (dto.archived_at !== undefined) patch.archivedAt = dto.archived_at ? new Date(dto.archived_at) : null;

    // query always reflects the effective filters (new if provided, else the stored ones).
    const effectiveFilters = dto.filters !== undefined ? dto.filters : (existing.filters ?? {});
    patch.query = this.computeQuery(effectiveFilters);

    const updated = await this.repo.update(id, patch as IssueView);
    return serializeView(updated!);
  }
}
