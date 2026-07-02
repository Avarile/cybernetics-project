import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { RequestContextService } from "../../infra/context/request-context";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { ProjectScopedRepository } from "../../infra/database/project-scoped.repository";
import {
  estimatePoints,
  estimates,
  type Estimate,
  type EstimatePoint,
  type NewEstimate,
  type NewEstimatePoint,
} from "./estimate.schema";

@Injectable()
export class EstimateRepository extends ProjectScopedRepository<typeof estimates> {
  constructor(@Inject(DRIZZLE) db: Database, ctx: RequestContextService) {
    super(db, estimates, ctx);
  }

  // ---- Estimates -----------------------------------------------------------

  // Django ordering = ("name",); default manager excludes soft-deleted rows.
  listByProject(projectId: string): Promise<Estimate[]> {
    return this.db
      .select()
      .from(estimates)
      .where(and(isNull(estimates.deletedAt), eq(estimates.projectId, projectId)))
      .orderBy(asc(estimates.name));
  }

  async findInProject(projectId: string, id: string): Promise<Estimate | null> {
    const rows = await this.db
      .select()
      .from(estimates)
      .where(and(isNull(estimates.deletedAt), eq(estimates.projectId, projectId), eq(estimates.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateEstimate(id: string, patch: Partial<NewEstimate>): Promise<Estimate | null> {
    return this.update(id, patch);
  }

  /**
   * The current-estimate FK lives on the projects table (`project.estimate_id`), which the
   * project schema in this port only exposes as a subset. Read the column directly so we do not
   * have to extend project.schema.ts (out of scope for this module).
   */
  async projectCurrentEstimateId(projectId: string): Promise<string | null> {
    const result = await this.db.execute<{ estimate_id: string | null }>(
      sql`SELECT estimate_id FROM projects WHERE id = ${projectId} AND deleted_at IS NULL LIMIT 1`,
    );
    return result.rows[0]?.estimate_id ?? null;
  }

  // ---- Estimate points -----------------------------------------------------

  // Django EstimatePoint Meta ordering = ("value",).
  listPoints(projectId: string, estimateId: string): Promise<EstimatePoint[]> {
    return this.db
      .select()
      .from(estimatePoints)
      .where(
        and(
          isNull(estimatePoints.deletedAt),
          eq(estimatePoints.projectId, projectId),
          eq(estimatePoints.estimateId, estimateId),
        ),
      )
      .orderBy(asc(estimatePoints.value));
  }

  async findPoint(projectId: string, estimateId: string, pointId: string): Promise<EstimatePoint | null> {
    const rows = await this.db
      .select()
      .from(estimatePoints)
      .where(
        and(
          isNull(estimatePoints.deletedAt),
          eq(estimatePoints.projectId, projectId),
          eq(estimatePoints.estimateId, estimateId),
          eq(estimatePoints.id, pointId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findPointsByIds(projectId: string, estimateId: string, ids: string[]): Promise<EstimatePoint[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(estimatePoints)
      .where(
        and(
          isNull(estimatePoints.deletedAt),
          eq(estimatePoints.projectId, projectId),
          eq(estimatePoints.estimateId, estimateId),
          inArray(estimatePoints.id, ids),
        ),
      );
  }

  async createPoint(values: NewEstimatePoint): Promise<EstimatePoint> {
    const userId = this.currentUserId();
    const rows = await this.db
      .insert(estimatePoints)
      .values({ createdBy: userId, updatedBy: userId, ...values })
      .returning();
    return rows[0];
  }

  // Mirrors bulk_create(..., ignore_conflicts=True).
  async bulkCreatePoints(values: NewEstimatePoint[]): Promise<EstimatePoint[]> {
    if (values.length === 0) return [];
    const userId = this.currentUserId();
    const stamped = values.map((v) => ({ createdBy: userId, updatedBy: userId, ...v }));
    return this.db.insert(estimatePoints).values(stamped).onConflictDoNothing().returning();
  }

  async updatePoint(id: string, patch: Partial<NewEstimatePoint>): Promise<EstimatePoint | null> {
    const rows = await this.db
      .update(estimatePoints)
      .set({ ...patch, updatedBy: this.currentUserId() })
      .where(eq(estimatePoints.id, id))
      .returning();
    return rows[0] ?? null;
  }

  // SoftDeleteModel.delete(): EstimatePoint.delete() is a soft delete.
  async softDeletePoint(id: string): Promise<void> {
    await this.db
      .update(estimatePoints)
      .set({ deletedAt: new Date(), updatedBy: this.currentUserId() })
      .where(eq(estimatePoints.id, id));
  }
}
