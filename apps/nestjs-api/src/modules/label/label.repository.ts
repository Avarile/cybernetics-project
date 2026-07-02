import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, max, ne, sql } from "drizzle-orm";
import { ClsService } from "nestjs-cls";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { ProjectScopedRepository } from "../../infra/database/project-scoped.repository";
import { labels, type Label } from "./label.schema";

@Injectable()
export class LabelRepository extends ProjectScopedRepository<typeof labels> {
  constructor(@Inject(DRIZZLE) db: Database, cls: ClsService) {
    super(db, labels, cls);
  }

  listByProject(projectId: string): Promise<Label[]> {
    return this.db
      .select()
      .from(labels)
      .where(and(isNull(labels.deletedAt), eq(labels.projectId, projectId)))
      .orderBy(asc(labels.sortOrder));
  }

  async findInProject(projectId: string, id: string): Promise<Label | null> {
    const rows = await this.db
      .select()
      .from(labels)
      .where(and(isNull(labels.deletedAt), eq(labels.projectId, projectId), eq(labels.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async maxSortOrder(projectId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ largest: max(labels.sortOrder) })
      .from(labels)
      .where(and(eq(labels.projectId, projectId), isNull(labels.deletedAt)));
    return row?.largest ?? null;
  }

  async nameExists(projectId: string, name: string, excludeId?: string): Promise<boolean> {
    const conditions = [
      eq(labels.projectId, projectId),
      sql`lower(${labels.name}) = ${name.toLowerCase()}`,
      isNull(labels.deletedAt),
    ];
    if (excludeId) conditions.push(ne(labels.id, excludeId));
    const rows = await this.db.select({ x: sql`1` }).from(labels).where(and(...conditions)).limit(1);
    return rows.length > 0;
  }
}
