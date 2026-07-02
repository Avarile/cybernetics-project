import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateCycleDto, UpdateCycleDto } from "./dto/cycle.dto";
import { CycleRepository } from "./cycle.repository";
import { serializeCycle, type CycleDTO } from "./cycle.serializer";
import type { Cycle } from "./cycle.schema";

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

/**
 * NOTE on dates: Django's CycleWriteSerializer.validate runs the provided start/end through
 * convert_to_utc() using the project's timezone (stripping to date, then re-anchoring to UTC at the
 * project TZ boundaries). That project-timezone conversion is a phase-2 refinement — here we parse
 * the supplied ISO datetime as-is and keep the both-or-neither + start<=end validation faithful.
 */
@Injectable()
export class CycleService {
  constructor(private readonly repo: CycleRepository) {}

  async create(projectId: string, dto: CreateCycleDto, ownedById: string): Promise<CycleDTO> {
    const startDate = dto.start_date ? new Date(dto.start_date) : null;
    const endDate = dto.end_date ? new Date(dto.end_date) : null;

    // CycleViewSet.create: both dates required or both null.
    if ((startDate === null) !== (endDate === null)) {
      throw new BadRequestException({ error: "Both start date and end date are either required or are to be null" });
    }
    // CycleWriteSerializer.validate: start cannot exceed end.
    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException("Start date cannot exceed end date");
    }

    // Cycle.save(): sort_order = smallest existing sort_order - 10000, else the model default (65535).
    const smallest = await this.repo.minSortOrder(projectId);
    const sortOrder = smallest !== null ? smallest - 10000 : 65535;

    try {
      const cycle = await this.repo.create({
        projectId,
        name: dto.name,
        description: dto.description ?? "",
        startDate,
        endDate,
        ownedBy: ownedById, // Django: serializer.save(owned_by=request.user)
        sortOrder,
        externalSource: dto.external_source,
        externalId: dto.external_id,
        viewProps: dto.view_props ?? {},
        logoProps: dto.logo_props ?? {},
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
      } as Cycle);
      return serializeCycle(cycle);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ error: "Cycle already exists" });
      throw err;
    }
  }

  async list(projectId: string): Promise<CycleDTO[]> {
    const rows = await this.repo.listByProject(projectId);
    return rows.map((c) => serializeCycle(c));
  }

  async retrieve(projectId: string, id: string): Promise<CycleDTO> {
    const cycle = await this.repo.findInProject(projectId, id);
    // Django retrieve filters archived_at__isnull=True -> archived cycles are "not found".
    if (!cycle || cycle.archivedAt) throw new NotFoundException({ error: "Cycle not found" });
    return serializeCycle(cycle);
  }

  async update(projectId: string, id: string, dto: UpdateCycleDto): Promise<CycleDTO> {
    const existing = await this.repo.findInProject(projectId, id);
    if (!existing) throw new NotFoundException({ error: "Cycle not found" });
    // CycleViewSet.partial_update: archived cycles cannot be edited.
    if (existing.archivedAt) throw new BadRequestException({ error: "Archived cycle cannot be updated" });

    // A completed cycle (end_date in the past) may only have its sort_order changed.
    let effective: UpdateCycleDto = dto;
    if (existing.endDate && existing.endDate < new Date()) {
      if (dto.sort_order !== undefined) {
        effective = { sort_order: dto.sort_order };
      } else {
        throw new BadRequestException({ error: "The Cycle has already been completed so it cannot be edited" });
      }
    }

    // Resolve the post-update date pair for the start<=end check.
    const startDate =
      effective.start_date !== undefined ? (effective.start_date ? new Date(effective.start_date) : null) : existing.startDate;
    const endDate =
      effective.end_date !== undefined ? (effective.end_date ? new Date(effective.end_date) : null) : existing.endDate;
    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException("Start date cannot exceed end date");
    }

    const patch: Partial<Cycle> = {
      ...(effective.name !== undefined ? { name: effective.name } : {}),
      ...(effective.description !== undefined ? { description: effective.description } : {}),
      ...(effective.start_date !== undefined ? { startDate: effective.start_date ? new Date(effective.start_date) : null } : {}),
      ...(effective.end_date !== undefined ? { endDate: effective.end_date ? new Date(effective.end_date) : null } : {}),
      ...(effective.sort_order !== undefined ? { sortOrder: effective.sort_order } : {}),
      ...(effective.external_source !== undefined ? { externalSource: effective.external_source } : {}),
      ...(effective.external_id !== undefined ? { externalId: effective.external_id } : {}),
      ...(effective.view_props !== undefined ? { viewProps: effective.view_props } : {}),
      ...(effective.logo_props !== undefined ? { logoProps: effective.logo_props } : {}),
      ...(effective.timezone !== undefined ? { timezone: effective.timezone } : {}),
    };

    try {
      const updated = await this.repo.update(id, patch as Cycle);
      return serializeCycle(updated!);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ error: "Cycle already exists" });
      throw err;
    }
  }

  async destroy(projectId: string, id: string): Promise<void> {
    const cycle = await this.repo.findInProject(projectId, id);
    if (!cycle) throw new NotFoundException({ error: "Cycle not found" });
    // Django enqueues a cycle.activity.deleted issue_activity and clears UserFavorite/UserRecentVisit.
    // TODO(phase2): cycle-issues (needs issues table) — enqueue the delete activity with cycle issue ids
    // and clear the cycle's favorites/recent-visits once those tables exist.
    await this.repo.softDelete(id);
  }

  // --- Archive / unarchive (CycleArchiveUnarchiveEndpoint) ---

  async archive(projectId: string, id: string): Promise<{ archived_at: string }> {
    const cycle = await this.repo.findInProject(projectId, id);
    if (!cycle) throw new NotFoundException({ error: "Cycle not found" });
    // Django: `if cycle.end_date >= now` -> only completed cycles can be archived (a cycle with no
    // end_date has not completed, so it is not archivable either).
    if (!cycle.endDate || cycle.endDate >= new Date()) {
      throw new BadRequestException({ error: "Only completed cycles can be archived" });
    }
    const archivedAt = new Date();
    await this.repo.update(id, { archivedAt } as Partial<Cycle>);
    // TODO(phase2): cycle-issues (needs issues table) — clear this cycle's UserFavorite rows.
    return { archived_at: archivedAt.toISOString() };
  }

  async unarchive(projectId: string, id: string): Promise<void> {
    const cycle = await this.repo.findInProject(projectId, id);
    if (!cycle) throw new NotFoundException({ error: "Cycle not found" });
    await this.repo.update(id, { archivedAt: null } as Partial<Cycle>);
  }

  async listArchived(projectId: string): Promise<CycleDTO[]> {
    const rows = await this.repo.listArchivedByProject(projectId);
    // TODO(phase2): cycle-issues (needs issues table) — the Django archived payload also carries
    // issue counts, assignee_ids and estimate_point aggregates from CycleIssue -> Issue.
    return rows.map((c) => serializeCycle(c, { includeArchivedAt: true }));
  }
}

// TODO(phase2): cycle-issues (needs issues table) — CycleIssueViewSet (list/create/retrieve/update/
// destroy under cycles/:cycle_id/cycle-issues) and TransferCycleIssueEndpoint
// (cycles/:cycle_id/transfer-issues) both depend on the issues + cycle_issues tables.
