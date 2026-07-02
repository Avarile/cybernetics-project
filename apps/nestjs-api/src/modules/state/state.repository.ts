import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, max, type SQL } from "drizzle-orm";
import { ClsService } from "nestjs-cls";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { ProjectScopedRepository } from "../../infra/database/project-scoped.repository";
import { states, type State } from "./state.schema";

@Injectable()
export class StateRepository extends ProjectScopedRepository<typeof states> {
  constructor(@Inject(DRIZZLE) db: Database, cls: ClsService) {
    super(db, states, cls);
  }

  // StateManager: default queryset excludes triage (and soft-deleted).
  protected override defaultScope(): SQL | undefined {
    return and(isNull(states.deletedAt), eq(states.isTriage, false));
  }

  listByProject(projectId: string): Promise<State[]> {
    return this.db
      .select()
      .from(states)
      .where(and(this.defaultScope(), eq(states.projectId, projectId)))
      .orderBy(asc(states.sequence));
  }

  async findInProject(projectId: string, id: string): Promise<State | null> {
    const rows = await this.db
      .select()
      .from(states)
      .where(and(this.defaultScope(), eq(states.projectId, projectId), eq(states.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async maxSequence(projectId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ largest: max(states.sequence) })
      .from(states)
      .where(and(eq(states.projectId, projectId), isNull(states.deletedAt)));
    return row?.largest ?? null;
  }

  async clearDefault(projectId: string): Promise<void> {
    await this.db.update(states).set({ default: false }).where(eq(states.projectId, projectId));
  }

  async setDefault(projectId: string, id: string): Promise<void> {
    await this.db.update(states).set({ default: true }).where(and(eq(states.projectId, projectId), eq(states.id, id)));
  }
}
