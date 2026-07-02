import { BadRequestException, Injectable } from "@nestjs/common";
import { slugify } from "../../shared/slugify";
import type { CreateStateDto, UpdateStateDto } from "./dto/state.dto";
import { StateRepository } from "./state.repository";
import { serializeState, type StateDTO } from "./state.serializer";
import type { State } from "./state.schema";

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

@Injectable()
export class StateService {
  constructor(private readonly repo: StateRepository) {}

  async create(projectId: string, dto: CreateStateDto): Promise<StateDTO> {
    if (dto.group === "triage") throw new BadRequestException("Cannot create triage state");

    const largest = await this.repo.maxSequence(projectId);
    const sequence = largest !== null ? largest + 15000 : 65535;

    try {
      const state = await this.repo.create({
        projectId,
        name: dto.name,
        color: dto.color,
        group: (dto.group as State["group"]) ?? "backlog",
        description: dto.description ?? "",
        slug: slugify(dto.name),
        sequence,
        externalSource: dto.external_source,
        externalId: dto.external_id,
      } as State);
      return serializeState(state);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ name: "The state name is already taken" });
      throw err;
    }
  }

  /** Returns either an array of states (with per-group `order`) or a group->states dict when grouped. */
  async list(projectId: string, grouped: boolean): Promise<StateDTO[] | Record<string, StateDTO[]>> {
    const rows = await this.repo.listByProject(projectId);

    // group by `group`, preserving sequence order; order = index / count within the group
    const byGroup = new Map<string, State[]>();
    for (const s of rows) {
      const key = s.group ?? "backlog";
      (byGroup.get(key) ?? byGroup.set(key, []).get(key)!).push(s);
    }
    const serialized: StateDTO[] = [];
    for (const [, groupStates] of byGroup) {
      const count = groupStates.length;
      groupStates.forEach((s, i) => serialized.push(serializeState(s, (i + 1) / count)));
    }

    if (grouped) {
      const dict: Record<string, StateDTO[]> = {};
      for (const s of serialized) (dict[s.group ?? "backlog"] ??= []).push(s);
      return dict;
    }
    return serialized;
  }

  async retrieve(projectId: string, id: string): Promise<StateDTO> {
    const state = await this.repo.findInProject(projectId, id);
    if (!state) throw new BadRequestException("The required object does not exist.");
    return serializeState(state);
  }

  async update(projectId: string, id: string, dto: UpdateStateDto): Promise<StateDTO> {
    const existing = await this.repo.findInProject(projectId, id);
    if (!existing) throw new BadRequestException("The required object does not exist.");
    try {
      const patch: Partial<State> = { ...dto } as Partial<State>;
      if (dto.name) patch.slug = slugify(dto.name);
      const updated = await this.repo.update(id, patch as State);
      return serializeState(updated!);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ name: "The state name is already taken" });
      throw err;
    }
  }

  async markDefault(projectId: string, id: string): Promise<void> {
    await this.repo.clearDefault(projectId);
    await this.repo.setDefault(projectId, id);
  }

  async destroy(projectId: string, id: string): Promise<void> {
    const state = await this.repo.findInProject(projectId, id);
    if (!state) throw new BadRequestException("The required object does not exist.");
    if (state.default) throw new BadRequestException({ error: "Default state cannot be deleted" });
    await this.repo.softDelete(id);
  }
}
