import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { RequestContextService } from "../../infra/context/request-context";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { ProjectScopedRepository } from "../../infra/database/project-scoped.repository";
import { projects } from "../../infra/database/schema/project.schema";
import { users } from "../../infra/database/schema/user.schema";
import { cycles } from "../cycle/cycle.schema";
import { estimatePoints, estimates } from "../estimate/estimate.schema";
import { issues } from "../issue/issue.schema";
import { labels } from "../label/label.schema";
import { modules } from "../project-module/module.schema";
import { states } from "../state/state.schema";
import { issueActivities, type IssueActivityRow, type NewIssueActivity } from "./activity.schema";

type NamedRef = { id: string; name: string };

/**
 * Persistence + lookup helper for the issue_activity engine. Bulk-writes IssueActivity rows and
 * resolves the human-readable values Django's track_* handlers fetch (state/label/user/estimate/
 * cycle/module names, parent/related-issue "IDENT-seq" refs).
 */
@Injectable()
export class ActivityRepository extends ProjectScopedRepository<typeof issueActivities> {
  constructor(@Inject(DRIZZLE) db: Database, ctx: RequestContextService) {
    super(db, issueActivities, ctx);
  }

  /** Project.objects.get(pk=project_id).workspace_id — the tenancy anchor for every row. */
  async workspaceIdForProject(projectId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return row?.workspaceId ?? null;
  }

  /** issue.updated_at = now() — issue_activity() bumps the issue on every change. */
  async touchIssue(issueId: string): Promise<void> {
    await this.db.update(issues).set({ updatedAt: new Date() }).where(eq(issues.id, issueId));
  }

  /** Issue fields create_issue_activity copies onto the "created the issue" row. */
  async getIssue(
    issueId: string,
  ): Promise<{ id: string; createdAt: Date; createdBy: string | null } | null> {
    const [row] = await this.db
      .select({ id: issues.id, createdAt: issues.createdAt, createdBy: issues.createdBy })
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);
    return row ?? null;
  }

  /** "{project.identifier}-{sequence_id}" plus the issue id (track_parent / relation handlers). */
  async issueRef(issueId: string): Promise<{ id: string; ref: string } | null> {
    const [row] = await this.db
      .select({ id: issues.id, seq: issues.sequenceId, identifier: projects.identifier })
      .from(issues)
      .innerJoin(projects, eq(issues.projectId, projects.id))
      .where(eq(issues.id, issueId))
      .limit(1);
    return row ? { id: row.id, ref: `${row.identifier ?? ""}-${row.seq ?? ""}` } : null;
  }

  /** State.objects.filter(pk=..., project_id=...).first() → name + id. */
  async getState(projectId: string, stateId: string): Promise<NamedRef | null> {
    const [row] = await this.db
      .select({ id: states.id, name: states.name })
      .from(states)
      .where(and(eq(states.id, stateId), eq(states.projectId, projectId)))
      .limit(1);
    return row ?? null;
  }

  async getLabel(labelId: string): Promise<NamedRef | null> {
    const [row] = await this.db
      .select({ id: labels.id, name: labels.name })
      .from(labels)
      .where(eq(labels.id, labelId))
      .limit(1);
    return row ?? null;
  }

  /** User.objects.get(pk=...).display_name. */
  async getUser(userId: string): Promise<{ id: string; displayName: string | null } | null> {
    const [row] = await this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

  /** EstimatePoint value + its parent estimate's type (field = "estimate_" + type). */
  async getEstimatePoint(
    estimatePointId: string,
  ): Promise<{ id: string; value: string; type: string | null } | null> {
    const [row] = await this.db
      .select({ id: estimatePoints.id, value: estimatePoints.value, type: estimates.type })
      .from(estimatePoints)
      .innerJoin(estimates, eq(estimatePoints.estimateId, estimates.id))
      .where(eq(estimatePoints.id, estimatePointId))
      .limit(1);
    return row ?? null;
  }

  async getCycle(cycleId: string): Promise<NamedRef | null> {
    const [row] = await this.db
      .select({ id: cycles.id, name: cycles.name })
      .from(cycles)
      .where(eq(cycles.id, cycleId))
      .limit(1);
    return row ?? null;
  }

  async getModule(moduleId: string): Promise<NamedRef | null> {
    const [row] = await this.db
      .select({ id: modules.id, name: modules.name })
      .from(modules)
      .where(eq(modules.id, moduleId))
      .limit(1);
    return row ?? null;
  }

  /** Most recent activity for an issue (track_description coalescing check). */
  async lastActivity(
    issueId: string,
  ): Promise<{ id: string; field: string | null; actorId: string | null } | null> {
    const [row] = await this.db
      .select({ id: issueActivities.id, field: issueActivities.field, actorId: issueActivities.actorId })
      .from(issueActivities)
      .where(eq(issueActivities.issueId, issueId))
      .orderBy(desc(issueActivities.createdAt))
      .limit(1);
    return row ?? null;
  }

  async touchActivityCreatedAt(id: string): Promise<void> {
    await this.db.update(issueActivities).set({ createdAt: new Date() }).where(eq(issueActivities.id, id));
  }

  /**
   * IssueActivity.objects.bulk_create(...) — bulk_create bypasses BaseModel.save(), so created_by /
   * updated_by are NOT stamped (they stay null). Returns the inserted rows.
   */
  async bulkInsert(rows: NewIssueActivity[]): Promise<IssueActivityRow[]> {
    if (rows.length === 0) return [];
    return (await this.db.insert(issueActivities).values(rows).returning()) as unknown as IssueActivityRow[];
  }

  /** IssueActivity.objects.create(...) — a single row (the "created the issue" audit entry). */
  async insertOne(row: NewIssueActivity): Promise<IssueActivityRow> {
    const [inserted] = (await this.db
      .insert(issueActivities)
      .values(row)
      .returning()) as unknown as IssueActivityRow[];
    return inserted;
  }
}
