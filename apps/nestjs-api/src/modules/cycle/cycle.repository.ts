import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNotNull, isNull, min } from "drizzle-orm";
import { RequestContextService } from "../../infra/context/request-context";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { ProjectScopedRepository } from "../../infra/database/project-scoped.repository";
import { cycles, type Cycle } from "./cycle.schema";

@Injectable()
export class CycleRepository extends ProjectScopedRepository<typeof cycles> {
  constructor(@Inject(DRIZZLE) db: Database, ctx: RequestContextService) {
    super(db, cycles, ctx);
  }

  /** Active (non-archived) cycles. Django list() filters archived_at__isnull=True, orders newest first. */
  listByProject(projectId: string): Promise<Cycle[]> {
    return this.db
      .select()
      .from(cycles)
      .where(and(isNull(cycles.deletedAt), eq(cycles.projectId, projectId), isNull(cycles.archivedAt)))
      .orderBy(desc(cycles.createdAt));
  }

  /** Archived cycles (CycleArchiveUnarchiveEndpoint.get with pk=None). */
  listArchivedByProject(projectId: string): Promise<Cycle[]> {
    return this.db
      .select()
      .from(cycles)
      .where(and(isNull(cycles.deletedAt), eq(cycles.projectId, projectId), isNotNull(cycles.archivedAt)))
      .orderBy(desc(cycles.createdAt));
  }

  /** Fetch a live cycle (any archive state) — callers decide how to treat archived_at. */
  async findInProject(projectId: string, id: string): Promise<Cycle | null> {
    const rows = await this.db
      .select()
      .from(cycles)
      .where(and(isNull(cycles.deletedAt), eq(cycles.projectId, projectId), eq(cycles.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Cycle.save(): on create, sort_order = min(sort_order) - 10000 (newest gets the smallest value). */
  async minSortOrder(projectId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ smallest: min(cycles.sortOrder) })
      .from(cycles)
      .where(and(eq(cycles.projectId, projectId), isNull(cycles.deletedAt)));
    return row?.smallest ?? null;
  }
}
