import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateEstimateDto,
  CreateEstimatePointDto,
  DeleteEstimatePointDto,
  UpdateEstimateDto,
  UpdateEstimatePointDto,
} from "./dto/estimate.dto";
import { EstimateRepository } from "./estimate.repository";
import type { EstimateType, NewEstimate, NewEstimatePoint } from "./estimate.schema";
import { serializeEstimate, serializeEstimatePoint, type EstimateDTO, type EstimatePointDTO } from "./estimate.serializer";

const PG_UNIQUE_VIOLATION = "23505";
// Django BaseViewSet.handle_exception maps IntegrityError -> 400 {"error": "The payload is not valid"}.
const DUP_MESSAGE = "The payload is not valid";
// Django BaseViewSet.handle_exception maps ObjectDoesNotExist -> 404 {"error": ...}.
const NOT_FOUND_MESSAGE = "The required object does not exist.";
const MAX_VALUE_LENGTH = 20;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

// Mirrors generate_random_name(length=10): 10 lowercase ASCII letters.
function generateRandomName(length = 10): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < length; i++) out += letters[Math.floor(Math.random() * letters.length)];
  return out;
}

@Injectable()
export class EstimateService {
  constructor(private readonly repo: EstimateRepository) {}

  // GET /project-estimates -> points of the project's current estimate, or [].
  async projectEstimates(projectId: string): Promise<EstimatePointDTO[]> {
    const estimateId = await this.repo.projectCurrentEstimateId(projectId);
    if (!estimateId) return [];
    const points = await this.repo.listPoints(projectId, estimateId);
    return points.map(serializeEstimatePoint);
  }

  // GET /estimates -> EstimateReadSerializer(many) with nested points.
  async list(projectId: string): Promise<EstimateDTO[]> {
    const estimates = await this.repo.listByProject(projectId);
    const result: EstimateDTO[] = [];
    for (const estimate of estimates) {
      const points = await this.repo.listPoints(projectId, estimate.id);
      result.push(serializeEstimate(estimate, points));
    }
    return result;
  }

  // GET /estimates/:estimate_id
  async retrieve(projectId: string, estimateId: string): Promise<EstimateDTO> {
    const estimate = await this.repo.findInProject(projectId, estimateId);
    if (!estimate) throw new NotFoundException({ error: NOT_FOUND_MESSAGE });
    const points = await this.repo.listPoints(projectId, estimateId);
    return serializeEstimate(estimate, points);
  }

  // POST /estimates -> create an estimate plus its bulk estimate points.
  async create(projectId: string, dto: CreateEstimateDto): Promise<EstimateDTO> {
    const meta = dto.estimate ?? {};
    const name = meta.name ?? generateRandomName();
    const type = (meta.type as EstimateType | undefined) ?? "categories";
    const lastUsed = meta.last_used ?? false;

    const points = dto.estimate_points ?? [];
    // EstimatePointSerializer.validate: value can't be more than 20 characters.
    for (const point of points) {
      if (point.value && point.value.length > MAX_VALUE_LENGTH) {
        throw new BadRequestException(`Value can't be more than ${MAX_VALUE_LENGTH} characters`);
      }
    }

    let estimate;
    try {
      estimate = await this.repo.create({ projectId, name, type, lastUsed } as NewEstimate);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ error: DUP_MESSAGE });
      throw err;
    }

    if (points.length) {
      const rows: NewEstimatePoint[] = points.map((point) => ({
        estimateId: estimate.id,
        projectId,
        workspaceId: estimate.workspaceId,
        key: point.key ?? 0,
        value: point.value ?? "",
        description: point.description ?? "",
      }));
      await this.repo.bulkCreatePoints(rows);
    }

    const created = await this.repo.listPoints(projectId, estimate.id);
    return serializeEstimate(estimate, created);
  }

  // PATCH /estimates/:estimate_id -> update estimate meta + its existing points.
  async update(projectId: string, estimateId: string, dto: UpdateEstimateDto): Promise<EstimateDTO> {
    const pointsData = dto.estimate_points ?? [];
    if (!pointsData.length) {
      throw new BadRequestException({ error: "Estimate points are required" });
    }

    const estimate = await this.repo.findInProject(projectId, estimateId);
    if (!estimate) throw new NotFoundException({ error: NOT_FOUND_MESSAGE });

    let current = estimate;
    if (dto.estimate) {
      const patch: Partial<NewEstimate> = {
        name: dto.estimate.name ?? estimate.name,
        type: (dto.estimate.type as EstimateType | undefined) ?? estimate.type ?? undefined,
      };
      const updated = await this.repo.updateEstimate(estimateId, patch);
      if (updated) current = updated;
    }

    const ids = pointsData.map((point) => point.id).filter((id): id is string => Boolean(id));
    const existingPoints = await this.repo.findPointsByIds(projectId, estimateId, ids);
    for (const point of existingPoints) {
      const data = pointsData.find((candidate) => candidate.id === point.id);
      if (!data) continue;
      await this.repo.updatePoint(point.id, {
        value: data.value ?? point.value,
        key: data.key ?? point.key ?? 0,
      });
    }

    const allPoints = await this.repo.listPoints(projectId, estimateId);
    return serializeEstimate(current, allPoints);
  }

  // DELETE /estimates/:estimate_id -> soft delete (204).
  async destroy(projectId: string, estimateId: string): Promise<void> {
    const estimate = await this.repo.findInProject(projectId, estimateId);
    if (!estimate) throw new NotFoundException({ error: NOT_FOUND_MESSAGE });
    await this.repo.softDelete(estimateId);
  }

  // POST /estimates/:estimate_id/estimate-points -> single point create (200).
  async createPoint(projectId: string, estimateId: string, dto: CreateEstimatePointDto): Promise<EstimatePointDTO> {
    // Django: `if not request.data.get("key") or not request.data.get("value")` — a falsy key
    // (missing OR 0) and an empty value are both rejected. Replicated faithfully.
    if (!dto.key || !dto.value) {
      throw new BadRequestException({ error: "Key and value are required" });
    }
    const estimate = await this.repo.findInProject(projectId, estimateId);
    if (!estimate) throw new NotFoundException({ error: "Estimate not found" });

    const point = await this.repo.createPoint({
      estimateId,
      projectId,
      workspaceId: estimate.workspaceId,
      key: dto.key ?? 0,
      value: dto.value ?? "",
    });
    return serializeEstimatePoint(point);
  }

  // PATCH /estimates/:estimate_id/estimate-points/:estimate_point_id -> single point update (200).
  async updatePoint(
    projectId: string,
    estimateId: string,
    pointId: string,
    dto: UpdateEstimatePointDto,
  ): Promise<EstimatePointDTO> {
    const point = await this.repo.findPoint(projectId, estimateId, pointId);
    if (!point) throw new NotFoundException({ error: NOT_FOUND_MESSAGE });

    // EstimatePointSerializer.validate: value can't be more than 20 characters.
    if (dto.value !== undefined && dto.value.length > MAX_VALUE_LENGTH) {
      throw new BadRequestException(`Value can't be more than ${MAX_VALUE_LENGTH} characters`);
    }

    const patch: Partial<NewEstimatePoint> = {};
    if (dto.key !== undefined) patch.key = dto.key;
    if (dto.value !== undefined) patch.value = dto.value;
    if (dto.description !== undefined) patch.description = dto.description;

    const updated = await this.repo.updatePoint(pointId, patch);
    return serializeEstimatePoint(updated ?? point);
  }

  // DELETE /estimates/:estimate_id/estimate-points/:estimate_point_id -> soft delete + re-key (200).
  async destroyPoint(
    projectId: string,
    estimateId: string,
    pointId: string,
    _dto: DeleteEstimatePointDto,
  ): Promise<EstimatePointDTO[]> {
    const allPoints = await this.repo.listPoints(projectId, estimateId);
    const oldPoint = await this.repo.findPoint(projectId, estimateId, pointId);
    if (!oldPoint) throw new NotFoundException({ error: "Estimate point not found" });

    // NOTE: Django also reassigns Issue.estimate_point (to `new_estimate_id`, else null) and emits
    // issue_activity for each affected issue. The Issue domain is not ported yet, so that
    // side-effect is intentionally out of scope for this module.

    const oldKey = oldPoint.key ?? 0;
    const updated: EstimatePointDTO[] = [];
    for (const point of allPoints) {
      if ((point.key ?? 0) > oldKey) {
        const row = await this.repo.updatePoint(point.id, { key: (point.key ?? 0) - 1 });
        if (row) updated.push(serializeEstimatePoint(row));
      }
    }

    await this.repo.softDeletePoint(oldPoint.id);
    return updated;
  }
}
