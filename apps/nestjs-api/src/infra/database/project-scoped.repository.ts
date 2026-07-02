import { eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { BaseRepository, type BaseColumnsShape } from "./base.repository";
import { projects } from "./schema";

/**
 * Base for ProjectBaseModel/WorkspaceBaseModel-scoped tables: derives workspace_id from project_id
 * on insert (Django's *BaseModel.save() copies workspace = project.workspace).
 */
export abstract class ProjectScopedRepository<
  T extends PgTable & BaseColumnsShape,
> extends BaseRepository<T> {
  protected async deriveTenancy<V extends { projectId?: string | null; workspaceId?: string | null }>(
    values: V,
  ): Promise<V> {
    if (values.projectId && !values.workspaceId) {
      const [row] = await this.db
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, values.projectId))
        .limit(1);
      if (row) (values as { workspaceId?: string | null }).workspaceId = row.workspaceId;
    }
    return values;
  }

  override async create(values: T["$inferInsert"]): Promise<T["$inferSelect"]> {
    const withTenancy = await this.deriveTenancy(values as { projectId?: string; workspaceId?: string });
    return super.create(withTenancy as T["$inferInsert"]);
  }
}
