import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { projects, workspaces, type Project } from "../../infra/database/schema";

@Injectable()
export class ProjectReadRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listByWorkspaceSlug(slug: string): Promise<Project[]> {
    return this.db
      .select({ p: projects })
      .from(projects)
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(and(eq(workspaces.slug, slug), isNull(projects.deletedAt)))
      .then((rows) => rows.map((r) => r.p));
  }

  async findInWorkspaceSlug(slug: string, id: string): Promise<Project | null> {
    const rows = await this.db
      .select({ p: projects })
      .from(projects)
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(and(eq(workspaces.slug, slug), eq(projects.id, id), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0]?.p ?? null;
  }
}

export function serializeProject(p: Project) {
  return {
    id: p.id,
    name: p.name,
    identifier: p.identifier,
    description: p.description,
    workspace: p.workspaceId,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    created_by: p.createdBy,
    updated_by: p.updatedBy,
  };
}
