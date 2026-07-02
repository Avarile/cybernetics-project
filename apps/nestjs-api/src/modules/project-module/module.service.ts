import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateModuleDto, UpdateModuleDto } from "./dto/module.dto";
import { ModuleRepository } from "./module.repository";
import type { Module, ModuleStatus } from "./module.schema";
import { serializeModule, type ModuleDTO } from "./module.serializer";

const PG_UNIQUE_VIOLATION = "23505";
const DUP_MESSAGE = "Module with this name already exists";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

/** ModuleWriteSerializer.validate: start_date cannot exceed target_date (when both are provided). */
function assertDateOrder(startDate?: string | null, targetDate?: string | null): void {
  if (startDate && targetDate && new Date(startDate) > new Date(targetDate)) {
    throw new BadRequestException("Start date cannot exceed target date");
  }
}

@Injectable()
export class ModuleService {
  constructor(private readonly repo: ModuleRepository) {}

  async create(projectId: string, dto: CreateModuleDto): Promise<ModuleDTO> {
    assertDateOrder(dto.start_date, dto.target_date);

    // ModuleWriteSerializer.create: reject a duplicate name up front.
    if (await this.repo.nameExists(projectId, dto.name)) {
      throw new BadRequestException({ error: DUP_MESSAGE });
    }

    // Module.save(): new modules sort before existing ones (smallest sort_order - 10000).
    const smallest = await this.repo.minSortOrder(projectId);
    const sortOrder = smallest !== null ? smallest - 10000 : 65535;

    try {
      const module = await this.repo.create({
        projectId,
        name: dto.name,
        description: dto.description ?? "",
        descriptionText: dto.description_text ?? null,
        descriptionHtml: dto.description_html ?? null,
        startDate: dto.start_date ?? null,
        targetDate: dto.target_date ?? null,
        status: (dto.status as ModuleStatus) ?? "planned",
        leadId: dto.lead_id ?? null,
        viewProps: dto.view_props ?? {},
        logoProps: dto.logo_props ?? {},
        sortOrder,
        externalSource: dto.external_source ?? null,
        externalId: dto.external_id ?? null,
      } as Module);

      if (dto.member_ids !== undefined) {
        await this.repo.replaceMembers(module, dto.member_ids);
      }
      const memberIds = await this.repo.memberIds(module.id);
      return serializeModule(module, memberIds);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ error: DUP_MESSAGE });
      throw err;
    }
  }

  async list(projectId: string): Promise<ModuleDTO[]> {
    const rows = await this.repo.listByProject(projectId);
    const members = await this.repo.memberIdsByModules(rows.map((m) => m.id));
    return rows.map((m) => serializeModule(m, members.get(m.id) ?? []));
  }

  async listArchived(projectId: string): Promise<ModuleDTO[]> {
    const rows = await this.repo.listArchived(projectId);
    const members = await this.repo.memberIdsByModules(rows.map((m) => m.id));
    return rows.map((m) => serializeModule(m, members.get(m.id) ?? []));
  }

  async retrieve(projectId: string, id: string): Promise<ModuleDTO> {
    const module = await this.repo.findActiveInProject(projectId, id);
    if (!module) throw new NotFoundException({ error: "Module not found" });
    const memberIds = await this.repo.memberIds(module.id);
    return serializeModule(module, memberIds);
  }

  async retrieveArchived(projectId: string, id: string): Promise<ModuleDTO> {
    const module = await this.repo.findArchivedInProject(projectId, id);
    if (!module) throw new NotFoundException({ error: "Module not found" });
    const memberIds = await this.repo.memberIds(module.id);
    return serializeModule(module, memberIds);
  }

  async update(projectId: string, id: string, dto: UpdateModuleDto): Promise<ModuleDTO> {
    const existing = await this.repo.findInProject(projectId, id);
    if (!existing) throw new NotFoundException({ error: "Module not found" });
    if (existing.archivedAt) throw new BadRequestException({ error: "Archived module cannot be updated" });

    assertDateOrder(dto.start_date, dto.target_date);

    if (dto.name && (await this.repo.nameExists(projectId, dto.name, id))) {
      throw new BadRequestException({ error: DUP_MESSAGE });
    }

    try {
      const patch: Partial<Module> = {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.description_text !== undefined ? { descriptionText: dto.description_text } : {}),
        ...(dto.description_html !== undefined ? { descriptionHtml: dto.description_html } : {}),
        ...(dto.start_date !== undefined ? { startDate: dto.start_date } : {}),
        ...(dto.target_date !== undefined ? { targetDate: dto.target_date } : {}),
        ...(dto.status !== undefined ? { status: dto.status as ModuleStatus } : {}),
        ...(dto.lead_id !== undefined ? { leadId: dto.lead_id } : {}),
        ...(dto.view_props !== undefined ? { viewProps: dto.view_props } : {}),
        ...(dto.logo_props !== undefined ? { logoProps: dto.logo_props } : {}),
        ...(dto.external_source !== undefined ? { externalSource: dto.external_source } : {}),
        ...(dto.external_id !== undefined ? { externalId: dto.external_id } : {}),
      };
      const updated = (await this.repo.update(id, patch)) ?? existing;

      if (dto.member_ids !== undefined) {
        await this.repo.replaceMembers(updated, dto.member_ids);
      }
      const memberIds = await this.repo.memberIds(updated.id);
      return serializeModule(updated, memberIds);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ error: DUP_MESSAGE });
      throw err;
    }
  }

  async archive(projectId: string, id: string): Promise<{ archived_at: string }> {
    const module = await this.repo.findInProject(projectId, id);
    if (!module) throw new NotFoundException({ error: "Module not found" });
    if (module.status !== "completed" && module.status !== "cancelled") {
      throw new BadRequestException({ error: "Only completed or cancelled modules can be archived" });
    }
    const archivedAt = new Date();
    await this.repo.setArchived(id, archivedAt);
    // TODO(phase2): delete UserFavorite rows for this module (needs user-favorites table).
    return { archived_at: archivedAt.toISOString() };
  }

  async unarchive(projectId: string, id: string): Promise<void> {
    const module = await this.repo.findInProject(projectId, id);
    if (!module) throw new NotFoundException({ error: "Module not found" });
    await this.repo.setArchived(id, null);
  }

  async destroy(projectId: string, id: string): Promise<void> {
    const module = await this.repo.findInProject(projectId, id);
    if (!module) throw new NotFoundException({ error: "Module not found" });
    await this.repo.softDelete(id);
    // TODO(phase2): module-issues (needs issues table) — cascade-delete ModuleIssue rows and fire
    // issue_activity "module.activity.deleted"; also clean up UserFavorite / UserRecentVisit.
  }
}
