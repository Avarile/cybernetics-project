import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { RequestContextService } from "../../infra/context/request-context";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { ProjectScopedRepository } from "../../infra/database/project-scoped.repository";
import { projects } from "../../infra/database/schema";
import { uuidToLockKey } from "../../shared/advisory-lock";
import { stripHtml } from "../../shared/strip-html";
import { states } from "../state/state.schema";
import { issueAssignees, issueLabels, issueSequences, issues, type Issue } from "./issue.schema";

export interface CreateIssueInput {
  name: string;
  stateId?: string | null;
  priority?: string;
  descriptionJson?: Record<string, unknown>;
  descriptionHtml?: string;
  startDate?: string | null;
  targetDate?: string | null;
  estimatePointId?: string | null;
  parentId?: string | null;
  isDraft?: boolean;
  assignees?: string[];
  labels?: string[];
}

export interface IssueAnnotations {
  label_ids: string[];
  assignee_ids: string[];
  module_ids: string[];
  sub_issues_count: number;
  attachment_count: number;
  link_count: number;
  cycle_id: string | null;
}

@Injectable()
export class IssueRepository extends ProjectScopedRepository<typeof issues> {
  constructor(@Inject(DRIZZLE) db: Database, ctx: RequestContextService) {
    super(db, issues, ctx);
  }

  // IssueManager: exclude soft-deleted + archived + draft by default.
  protected override defaultScope() {
    return and(isNull(issues.deletedAt), isNull(issues.archivedAt), eq(issues.isDraft, false));
  }

  private async deriveWorkspace(tx: Database, projectId: string): Promise<string> {
    const [row] = await tx.select({ w: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    return row.w;
  }

  private async resolveDefaultState(tx: Database, projectId: string): Promise<string | null> {
    const [def] = await tx
      .select({ id: states.id })
      .from(states)
      .where(and(eq(states.projectId, projectId), eq(states.default, true), eq(states.isTriage, false), isNull(states.deletedAt)))
      .limit(1);
    if (def) return def.id;
    const [first] = await tx
      .select({ id: states.id })
      .from(states)
      .where(and(eq(states.projectId, projectId), eq(states.isTriage, false), isNull(states.deletedAt)))
      .orderBy(asc(states.sequence))
      .limit(1);
    return first?.id ?? null;
  }

  private async stateGroup(tx: Database, stateId: string): Promise<string | null> {
    const [row] = await tx.select({ group: states.group }).from(states).where(eq(states.id, stateId)).limit(1);
    return row?.group ?? null;
  }

  /** Reproduces Issue.save() under a per-project advisory lock (serial sequence_id). */
  async createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
    const userId = this.currentUserId();
    return this.db.transaction(async (tx) => {
      const lockKey = uuidToLockKey(projectId);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey.toString()}::bigint)`);

      const [{ largest }] = await tx
        .select({ largest: max(issueSequences.sequence) })
        .from(issueSequences)
        .where(eq(issueSequences.projectId, projectId));
      const sequenceId = largest != null ? Number(largest) + 1 : 1;

      const stateId = input.stateId ?? (await this.resolveDefaultState(tx, projectId));
      const group = stateId ? await this.stateGroup(tx, stateId) : null;
      const completedAt = group === "completed" ? new Date() : null;

      const [{ largestSort }] = await tx
        .select({ largestSort: max(issues.sortOrder) })
        .from(issues)
        .where(and(eq(issues.projectId, projectId), stateId ? eq(issues.stateId, stateId) : sql`TRUE`));
      const sortOrder = largestSort != null ? largestSort + 10000 : 65535;

      const workspaceId = await this.deriveWorkspace(tx, projectId);
      const html = input.descriptionHtml ?? "<p></p>";

      const [issue] = await tx
        .insert(issues)
        .values({
          projectId,
          workspaceId,
          name: input.name,
          stateId,
          priority: (input.priority as Issue["priority"]) ?? "none",
          descriptionJson: input.descriptionJson ?? {},
          descriptionHtml: html,
          descriptionStripped: stripHtml(html),
          startDate: input.startDate ?? null,
          targetDate: input.targetDate ?? null,
          estimatePointId: input.estimatePointId ?? null,
          parentId: input.parentId ?? null,
          sequenceId,
          sortOrder,
          completedAt,
          isDraft: input.isDraft ?? false,
          createdBy: userId,
          updatedBy: null,
        })
        .returning();

      await tx.insert(issueSequences).values({ projectId, workspaceId, issueId: issue.id, sequence: sequenceId, createdBy: userId });

      if (input.assignees?.length) {
        await tx.insert(issueAssignees).values(
          input.assignees.map((assigneeId) => ({ projectId, workspaceId, issueId: issue.id, assigneeId, createdBy: userId })),
        );
      }
      if (input.labels?.length) {
        await tx.insert(issueLabels).values(
          input.labels.map((labelId) => ({ projectId, workspaceId, issueId: issue.id, labelId, createdBy: userId })),
        );
      }
      return issue;
    });
  }

  async findInProject(projectId: string, id: string): Promise<Issue | null> {
    const rows = await this.db
      .select()
      .from(issues)
      .where(and(isNull(issues.deletedAt), eq(issues.projectId, projectId), eq(issues.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  listByProject(projectId: string, offset: number, limit: number): Promise<Issue[]> {
    return this.db
      .select()
      .from(issues)
      .where(and(this.defaultScope(), eq(issues.projectId, projectId)))
      .orderBy(desc(issues.createdAt))
      .offset(offset)
      .limit(limit);
  }

  async countByProject(projectId: string): Promise<number> {
    const [row] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(issues)
      .where(and(this.defaultScope(), eq(issues.projectId, projectId)));
    return row?.c ?? 0;
  }

  async updateIssue(id: string, patch: Partial<Issue>): Promise<Issue | null> {
    const rows = await this.db
      .update(issues)
      .set({ ...patch, updatedBy: this.currentUserId() })
      .where(eq(issues.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /** Batch-load annotations for a set of issues (label_ids, assignee_ids, sub_issues_count). */
  async annotate(issueIds: string[]): Promise<Map<string, IssueAnnotations>> {
    const result = new Map<string, IssueAnnotations>();
    for (const id of issueIds) {
      result.set(id, {
        label_ids: [],
        assignee_ids: [],
        module_ids: [], // TODO(phase2): module_issues
        sub_issues_count: 0,
        attachment_count: 0, // TODO(phase2): file_assets
        link_count: 0, // TODO(phase2): issue_links
        cycle_id: null, // TODO(phase2): cycle_issues
      });
    }
    if (issueIds.length === 0) return result;

    const labelRows = await this.db
      .select({ issueId: issueLabels.issueId, labelId: issueLabels.labelId })
      .from(issueLabels)
      .where(and(inArray(issueLabels.issueId, issueIds), isNull(issueLabels.deletedAt)));
    for (const r of labelRows) result.get(r.issueId)?.label_ids.push(r.labelId);

    const assigneeRows = await this.db
      .select({ issueId: issueAssignees.issueId, assigneeId: issueAssignees.assigneeId })
      .from(issueAssignees)
      .where(and(inArray(issueAssignees.issueId, issueIds), isNull(issueAssignees.deletedAt)));
    for (const r of assigneeRows) result.get(r.issueId)?.assignee_ids.push(r.assigneeId);

    const subCounts = await this.db
      .select({ parentId: issues.parentId, c: sql<number>`count(*)::int` })
      .from(issues)
      .where(and(inArray(issues.parentId, issueIds), isNull(issues.deletedAt)))
      .groupBy(issues.parentId);
    for (const r of subCounts) {
      if (r.parentId) {
        const ann = result.get(r.parentId);
        if (ann) ann.sub_issues_count = r.c;
      }
    }
    return result;
  }

  async stateBelongsToProject(projectId: string, stateId: string): Promise<boolean> {
    const rows = await this.db
      .select({ x: sql`1` })
      .from(states)
      .where(and(eq(states.projectId, projectId), eq(states.id, stateId), isNull(states.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  async getStateGroup(stateId: string): Promise<string | null> {
    const [row] = await this.db.select({ group: states.group }).from(states).where(eq(states.id, stateId)).limit(1);
    return row?.group ?? null;
  }

  async isCreator(id: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ x: sql`1` })
      .from(issues)
      .where(and(eq(issues.id, id), eq(issues.createdBy, userId)))
      .limit(1);
    return rows.length > 0;
  }
}
