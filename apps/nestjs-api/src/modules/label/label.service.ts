import { BadRequestException, Injectable } from "@nestjs/common";
import { LabelRepository } from "./label.repository";
import { serializeLabel, type LabelDTO } from "./label.serializer";
import type { CreateLabelDto, UpdateLabelDto } from "./dto/label.dto";
import type { Label } from "./label.schema";

const PG_UNIQUE_VIOLATION = "23505";
const DUP_MESSAGE = "Label with the same name already exists in the project";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

@Injectable()
export class LabelService {
  constructor(private readonly repo: LabelRepository) {}

  async list(projectId: string): Promise<LabelDTO[]> {
    const rows = await this.repo.listByProject(projectId);
    return rows.map(serializeLabel);
  }

  async retrieve(projectId: string, id: string): Promise<LabelDTO> {
    const label = await this.repo.findInProject(projectId, id);
    if (!label) throw new BadRequestException("The required object does not exist.");
    return serializeLabel(label);
  }

  async create(projectId: string, dto: CreateLabelDto): Promise<LabelDTO> {
    if (await this.repo.nameExists(projectId, dto.name)) {
      throw new BadRequestException({ error: DUP_MESSAGE });
    }
    const largest = await this.repo.maxSortOrder(projectId);
    const sortOrder = largest !== null ? largest + 10000 : 65535;
    try {
      const label = await this.repo.create({
        projectId,
        name: dto.name,
        color: dto.color,
        parentId: dto.parent ?? null,
        description: dto.description ?? "",
        sortOrder,
      } as Label);
      return serializeLabel(label);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ error: DUP_MESSAGE });
      throw err;
    }
  }

  async update(projectId: string, id: string, dto: UpdateLabelDto): Promise<LabelDTO> {
    const existing = await this.repo.findInProject(projectId, id);
    if (!existing) throw new BadRequestException("The required object does not exist.");
    if (dto.name && (await this.repo.nameExists(projectId, dto.name, id))) {
      throw new BadRequestException({ error: DUP_MESSAGE });
    }
    try {
      const patch: Partial<Label> = {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.parent !== undefined ? { parentId: dto.parent } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      };
      const updated = await this.repo.update(id, patch as Label);
      return serializeLabel(updated!);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ error: DUP_MESSAGE });
      throw err;
    }
  }

  async destroy(projectId: string, id: string): Promise<void> {
    const label = await this.repo.findInProject(projectId, id);
    if (!label) throw new BadRequestException("The required object does not exist.");
    await this.repo.softDelete(id);
  }
}
