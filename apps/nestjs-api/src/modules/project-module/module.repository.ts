import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull, isNull, min } from "drizzle-orm";
import { RequestContextService } from "../../infra/context/request-context";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { ProjectScopedRepository } from "../../infra/database/project-scoped.repository";
import { moduleMembers, modules, type Module } from "./module.schema";

@Injectable()
export class ModuleRepository extends ProjectScopedRepository<typeof modules> {
  constructor(@Inject(DRIZZLE) db: Database, ctx: RequestContextService) {
    super(db, modules, ctx);
  }

  /** Non-archived modules for a project (Meta ordering: -created_at). */
  listByProject(projectId: string): Promise<Module[]> {
    return this.db
      .select()
      .from(modules)
      .where(and(isNull(modules.deletedAt), eq(modules.projectId, projectId), isNull(modules.archivedAt)))
      .orderBy(desc(modules.createdAt));
  }

  /** Archived modules for a project. */
  listArchived(projectId: string): Promise<Module[]> {
    return this.db
      .select()
      .from(modules)
      .where(and(isNull(modules.deletedAt), eq(modules.projectId, projectId), isNotNull(modules.archivedAt)))
      .orderBy(desc(modules.createdAt));
  }

  /** Any live module (archived or not) — used by update/destroy/archive. */
  async findInProject(projectId: string, id: string): Promise<Module | null> {
    const rows = await this.db
      .select()
      .from(modules)
      .where(and(isNull(modules.deletedAt), eq(modules.projectId, projectId), eq(modules.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Live, non-archived module — used by retrieve (Django filters archived_at__isnull=True). */
  async findActiveInProject(projectId: string, id: string): Promise<Module | null> {
    const rows = await this.db
      .select()
      .from(modules)
      .where(
        and(
          isNull(modules.deletedAt),
          eq(modules.projectId, projectId),
          eq(modules.id, id),
          isNull(modules.archivedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Live, archived module — used by the archived-modules retrieve route. */
  async findArchivedInProject(projectId: string, id: string): Promise<Module | null> {
    const rows = await this.db
      .select()
      .from(modules)
      .where(
        and(
          isNull(modules.deletedAt),
          eq(modules.projectId, projectId),
          eq(modules.id, id),
          isNotNull(modules.archivedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Module.save() quirk: new modules sort BEFORE existing ones (smallest sort_order - 10000). */
  async minSortOrder(projectId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ smallest: min(modules.sortOrder) })
      .from(modules)
      .where(and(eq(modules.projectId, projectId), isNull(modules.deletedAt)));
    return row?.smallest ?? null;
  }

  /** Exact name match within a project (Django: Module.objects.filter(name=..., project=...)). */
  async nameExists(projectId: string, name: string, excludeId?: string): Promise<boolean> {
    const conditions = [eq(modules.projectId, projectId), eq(modules.name, name), isNull(modules.deletedAt)];
    const rows = await this.db
      .select({ id: modules.id })
      .from(modules)
      .where(and(...conditions))
      .limit(2);
    return rows.some((r) => r.id !== excludeId);
  }

  setArchived(id: string, archivedAt: Date | null): Promise<Module | null> {
    return this.update(id, { archivedAt } as Partial<Module>);
  }

  // ---- ModuleMember (Module.members M2M through table) ----

  /** Member ids for a single module (live rows only). */
  async memberIds(moduleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ memberId: moduleMembers.memberId })
      .from(moduleMembers)
      .where(and(eq(moduleMembers.moduleId, moduleId), isNull(moduleMembers.deletedAt)));
    return rows.map((r) => r.memberId);
  }

  /** Member ids grouped by module id — avoids N+1 in list(). */
  async memberIdsByModules(moduleIds: string[]): Promise<Map<string, string[]>> {
    const grouped = new Map<string, string[]>();
    if (moduleIds.length === 0) return grouped;
    const rows = await this.db
      .select({ moduleId: moduleMembers.moduleId, memberId: moduleMembers.memberId })
      .from(moduleMembers)
      .where(and(inArray(moduleMembers.moduleId, moduleIds), isNull(moduleMembers.deletedAt)));
    for (const r of rows) {
      const list = grouped.get(r.moduleId) ?? grouped.set(r.moduleId, []).get(r.moduleId)!;
      list.push(r.memberId);
    }
    return grouped;
  }

  /**
   * Replace a module's members (ModuleWriteSerializer.create/update: delete then bulk_create with
   * ignore_conflicts). Hard-deletes existing links so the partial unique index stays clean.
   */
  async replaceMembers(
    module: { id: string; projectId: string; workspaceId: string },
    memberIds: string[],
  ): Promise<void> {
    await this.db.delete(moduleMembers).where(eq(moduleMembers.moduleId, module.id));
    if (memberIds.length === 0) return;
    const userId = this.currentUserId();
    const unique = Array.from(new Set(memberIds));
    await this.db
      .insert(moduleMembers)
      .values(
        unique.map((memberId) => ({
          moduleId: module.id,
          memberId,
          projectId: module.projectId,
          workspaceId: module.workspaceId,
          createdBy: userId,
          updatedBy: userId,
        })),
      )
      .onConflictDoNothing();
  }
}
