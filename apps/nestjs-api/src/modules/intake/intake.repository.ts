import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { RequestContextService } from "../../infra/context/request-context";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { ProjectScopedRepository } from "../../infra/database/project-scoped.repository";
import { projects } from "../../infra/database/schema";
import { states } from "../state/state.schema";
import { issues } from "../issue/issue.schema";
import type { ProjectLiteInput } from "./intake.serializer";
import {
  INTAKE_ISSUE_STATUS,
  intakeIssues,
  intakes,
  type Intake,
  type IntakeIssue,
  type IntakeIssueStatus,
  type NewIntakeIssue,
} from "./intake.schema";

/** A joined intake_issue + its issue row (Django `IntakeIssue.select_related("issue")`). */
export interface IntakeIssueWithIssue {
  intakeIssue: IntakeIssue;
  issue: typeof issues.$inferSelect;
}

@Injectable()
export class IntakeRepository extends ProjectScopedRepository<typeof intakes> {
  constructor(@Inject(DRIZZLE) db: Database, ctx: RequestContextService) {
    super(db, intakes, ctx);
  }

  // ---- Intake -------------------------------------------------------------

  /** Django IntakeViewSet uses `.filter(...).first()` (ordering = name). */
  async findFirstForProject(projectId: string): Promise<Intake | null> {
    const rows = await this.db
      .select()
      .from(intakes)
      .where(and(isNull(intakes.deletedAt), eq(intakes.projectId, projectId)))
      .orderBy(asc(intakes.name))
      .limit(1);
    return rows[0] ?? null;
  }

  async findInProject(projectId: string, id: string): Promise<Intake | null> {
    const rows = await this.db
      .select()
      .from(intakes)
      .where(and(isNull(intakes.deletedAt), eq(intakes.projectId, projectId), eq(intakes.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** pending_issue_count annotation: intake_issues with status = PENDING (-2). */
  async pendingIssueCount(intakeId: string): Promise<number> {
    const [row] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(intakeIssues)
      .where(
        and(
          eq(intakeIssues.intakeId, intakeId),
          eq(intakeIssues.status, INTAKE_ISSUE_STATUS.PENDING),
          isNull(intakeIssues.deletedAt),
        ),
      );
    return row?.c ?? 0;
  }

  /** ProjectLiteSerializer source data (only columns present in the ported projects table). */
  async findProjectLite(projectId: string): Promise<ProjectLiteInput | null> {
    const rows = await this.db
      .select({ id: projects.id, identifier: projects.identifier, name: projects.name, description: projects.description })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateIntake(id: string, patch: Partial<Intake>): Promise<Intake | null> {
    const rows = await this.db
      .update(intakes)
      .set({ ...patch, updatedBy: this.currentUserId() })
      .where(eq(intakes.id, id))
      .returning();
    return rows[0] ?? null;
  }

  // ---- State helpers (triage / default) -----------------------------------

  /** State.triage_objects.filter(...).first() — the project's triage state. */
  async findTriageState(projectId: string): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: states.id })
      .from(states)
      .where(and(eq(states.projectId, projectId), eq(states.isTriage, true), isNull(states.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Create the "Triage" state exactly as Django does when it is missing. */
  async createTriageState(projectId: string, workspaceId: string): Promise<{ id: string }> {
    const rows = await this.db
      .insert(states)
      .values({
        projectId,
        workspaceId,
        name: "Triage",
        group: "triage",
        color: "#4E5355",
        sequence: 65000,
        default: false,
        isTriage: true,
        createdBy: this.currentUserId(),
        updatedBy: null,
      })
      .returning({ id: states.id });
    return rows[0];
  }

  /** The project's default (non-triage) state, used when accepting an intake issue. */
  async findDefaultState(projectId: string): Promise<{ id: string; group: string | null } | null> {
    const rows = await this.db
      .select({ id: states.id, group: states.group })
      .from(states)
      .where(
        and(
          eq(states.projectId, projectId),
          eq(states.default, true),
          eq(states.isTriage, false),
          isNull(states.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // ---- IntakeIssue --------------------------------------------------------

  async createIntakeIssue(values: NewIntakeIssue): Promise<IntakeIssue> {
    const rows = await this.db
      .insert(intakeIssues)
      .values({ createdBy: this.currentUserId(), updatedBy: null, ...values })
      .returning();
    return rows[0];
  }

  /** Django keys intake-issue routes off the *issue* id (IntakeIssue.get(issue_id=pk, ...)). */
  async findByIssue(projectId: string, intakeId: string, issueId: string): Promise<IntakeIssue | null> {
    const rows = await this.db
      .select()
      .from(intakeIssues)
      .where(
        and(
          isNull(intakeIssues.deletedAt),
          eq(intakeIssues.projectId, projectId),
          eq(intakeIssues.intakeId, intakeId),
          eq(intakeIssues.issueId, issueId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private listWhere(intakeId: string, projectId: string, statuses: number[] | null) {
    const conds = [
      isNull(intakeIssues.deletedAt),
      eq(intakeIssues.intakeId, intakeId),
      eq(intakeIssues.projectId, projectId),
    ];
    if (statuses && statuses.length) conds.push(inArray(intakeIssues.status, statuses as IntakeIssueStatus[]));
    return and(...conds);
  }

  /** List intake issues joined to their issue, ordered by -issue.created_at (Django default). */
  async listIntakeIssues(
    intakeId: string,
    projectId: string,
    statuses: number[] | null,
    offset: number,
    limit: number,
  ): Promise<IntakeIssueWithIssue[]> {
    const rows = await this.db
      .select({ intakeIssue: intakeIssues, issue: issues })
      .from(intakeIssues)
      .innerJoin(issues, eq(intakeIssues.issueId, issues.id))
      .where(this.listWhere(intakeId, projectId, statuses))
      .orderBy(desc(issues.createdAt))
      .offset(offset)
      .limit(limit);
    return rows;
  }

  async countIntakeIssues(intakeId: string, projectId: string, statuses: number[] | null): Promise<number> {
    const [row] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(intakeIssues)
      .where(this.listWhere(intakeId, projectId, statuses));
    return row?.c ?? 0;
  }

  async updateIntakeIssue(id: string, patch: Partial<IntakeIssue>): Promise<IntakeIssue | null> {
    const rows = await this.db
      .update(intakeIssues)
      .set({ ...patch, updatedBy: this.currentUserId() })
      .where(eq(intakeIssues.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /** SoftDeleteModel.delete() on the intake_issue row. */
  async softDeleteIntakeIssue(id: string): Promise<void> {
    await this.db
      .update(intakeIssues)
      .set({ deletedAt: new Date(), updatedBy: this.currentUserId() })
      .where(eq(intakeIssues.id, id));
  }
}
