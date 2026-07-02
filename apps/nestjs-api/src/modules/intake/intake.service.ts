import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { RequestContextService } from "../../infra/context/request-context";
import { CeleryProducer } from "../../infra/queue/celery-producer.service";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { paginate, type CursorPageParams, type PaginatedResult } from "../../infra/pagination/paginate";
import { stripHtml } from "../../shared/strip-html";
import { IssueRepository } from "../issue/issue.repository";
import type { Issue } from "../issue/issue.schema";
import type { CreateIntakeDto, CreateIntakeIssueDto, UpdateIntakeDto, UpdateIntakeIssueDto } from "./dto/intake.dto";
import { IntakeRepository } from "./intake.repository";
import { INTAKE_ISSUE_STATUS, type Intake, type IntakeIssue, type IntakeIssueStatus } from "./intake.schema";
import {
  serializeIntake,
  serializeIntakeIssue,
  serializeIntakeIssueDetail,
  serializeIssueDetail,
  serializeIssueIntake,
  serializeProjectLite,
  type IntakeDTO,
  type IntakeIssueDTO,
  type IntakeIssueDetailDTO,
  type IssueIntakeDTO,
} from "./intake.serializer";

const PG_UNIQUE_VIOLATION = "23505";
const VALID_PRIORITIES = ["low", "medium", "high", "urgent", "none"];

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

@Injectable()
export class IntakeService {
  constructor(
    private readonly repo: IntakeRepository,
    private readonly issueRepo: IssueRepository,
    private readonly celery: CeleryProducer,
    private readonly ctx: RequestContextService,
  ) {}

  // ---- activity ------------------------------------------------------------

  private enqueueIssueActivity(
    type: string,
    projectId: string,
    issueId: string,
    intakeId: string,
    data: unknown,
    notification: boolean,
  ): void {
    const actorId = this.ctx.userId ?? null;
    const origin = this.ctx.store?.origin ?? null;
    const epoch = Math.floor(Date.now() / 1000);
    // fire-and-forget; the broker may be down (matches Django `.delay()`).
    void this.celery
      .enqueue(CELERY_TASKS.issueActivity, {
        type,
        requested_data: JSON.stringify(data),
        actor_id: actorId,
        issue_id: issueId,
        project_id: projectId,
        current_instance: null,
        epoch,
        notification,
        origin,
        intake: intakeId,
      })
      .catch(() => undefined);
  }

  // ---- Intake --------------------------------------------------------------

  private async serializeIntakeRow(intake: Intake): Promise<IntakeDTO> {
    const pending = await this.repo.pendingIssueCount(intake.id);
    const projectLite = await this.repo.findProjectLite(intake.projectId);
    return serializeIntake(intake, pending, projectLite ? serializeProjectLite(projectLite) : null);
  }

  /** IntakeViewSet.list — returns the first intake for the project (or {} when none). */
  async listIntakes(projectId: string): Promise<IntakeDTO | Record<string, never>> {
    const intake = await this.repo.findFirstForProject(projectId);
    if (!intake) return {};
    return this.serializeIntakeRow(intake);
  }

  async createIntake(projectId: string, dto: CreateIntakeDto): Promise<IntakeDTO> {
    try {
      const intake = (await this.repo.create({
        projectId,
        name: dto.name,
        description: dto.description ?? "",
        isDefault: dto.is_default ?? false,
        viewProps: dto.view_props ?? {},
        logoProps: dto.logo_props ?? {},
      } as Intake)) as Intake;
      return this.serializeIntakeRow(intake);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ name: "The intake name is already taken" });
      throw err;
    }
  }

  async retrieveIntake(projectId: string, id: string): Promise<IntakeDTO> {
    const intake = await this.repo.findInProject(projectId, id);
    if (!intake) throw new NotFoundException("The required object does not exist.");
    return this.serializeIntakeRow(intake);
  }

  async updateIntake(projectId: string, id: string, dto: UpdateIntakeDto): Promise<IntakeDTO> {
    const existing = await this.repo.findInProject(projectId, id);
    if (!existing) throw new NotFoundException("The required object does not exist.");
    const patch: Partial<Intake> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.is_default !== undefined) patch.isDefault = dto.is_default;
    if (dto.view_props !== undefined) patch.viewProps = dto.view_props;
    if (dto.logo_props !== undefined) patch.logoProps = dto.logo_props;
    try {
      const updated = await this.repo.updateIntake(id, patch);
      return this.serializeIntakeRow(updated!);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ name: "The intake name is already taken" });
      throw err;
    }
  }

  async destroyIntake(projectId: string, id: string): Promise<void> {
    const intake = await this.repo.findInProject(projectId, id);
    if (!intake) throw new NotFoundException("The required object does not exist.");
    // Handle default intake delete (Django returns 400).
    if (intake.isDefault) throw new BadRequestException({ error: "You cannot delete the default intake" });
    await this.repo.softDelete(id);
  }

  // ---- IntakeIssue helpers -------------------------------------------------

  private async requireIntake(projectId: string): Promise<Intake> {
    const intake = await this.repo.findFirstForProject(projectId);
    if (!intake) throw new NotFoundException({ error: "Intake not found" });
    return intake;
  }

  private async labelIdsFor(issueId: string): Promise<string[]> {
    const ann = await this.issueRepo.annotate([issueId]);
    return ann.get(issueId)?.label_ids ?? [];
  }

  /** Build IntakeIssueDetailSerializer output (create/retrieve/update responses). */
  private async buildDetail(ii: IntakeIssue, issue: Issue): Promise<IntakeIssueDetailDTO> {
    const ann = await this.issueRepo.annotate([issue.id]);
    const issueDetail = serializeIssueDetail(issue, ann.get(issue.id)!);

    let duplicateDetail: IssueIntakeDTO | null = null;
    if (ii.duplicateToId) {
      const dup = await this.issueRepo.findInProject(issue.projectId, ii.duplicateToId);
      if (dup) duplicateDetail = serializeIssueIntake(dup, await this.labelIdsFor(dup.id));
    }
    return serializeIntakeIssueDetail(ii, issueDetail, duplicateDetail);
  }

  /** IntakeIssueViewSet.list — paginated intake issues for the project's intake. */
  async listIntakeIssues(
    projectId: string,
    statusParam: string | undefined,
    params: CursorPageParams,
  ): Promise<PaginatedResult<IntakeIssueDTO>> {
    const intake = await this.requireIntake(projectId);

    // Django default status filter is "-2" (PENDING); "null" tokens are dropped, empty ⇒ no filter.
    const raw = statusParam ?? String(INTAKE_ISSUE_STATUS.PENDING);
    const parsed = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "" && s !== "null")
      .map((s) => Number(s))
      .filter((n) => !Number.isNaN(n));
    const statuses = parsed.length ? parsed : null;

    return paginate<IntakeIssueDTO>(
      params,
      () => this.repo.countIntakeIssues(intake.id, projectId, statuses),
      async ({ offset, limitPlusOne }) => {
        const rows = await this.repo.listIntakeIssues(intake.id, projectId, statuses, offset, limitPlusOne);
        const ann = await this.issueRepo.annotate(rows.map((r) => r.issue.id));
        return rows.map((r) =>
          serializeIntakeIssue(r.intakeIssue, r.issue, ann.get(r.issue.id)?.label_ids ?? []),
        );
      },
    );
  }

  /**
   * IntakeIssueViewSet.create — creates the Issue first (in the project's Triage state) via
   * IssueRepository.createIssue, then inserts the linking IntakeIssue row, then enqueues activity.
   */
  async createIntakeIssue(projectId: string, dto: CreateIntakeIssueDto): Promise<IntakeIssueDetailDTO> {
    const inner = dto.issue;
    if (!inner?.name) throw new BadRequestException({ error: "Name is required" });

    const priority = inner.priority ?? "none";
    if (!VALID_PRIORITIES.includes(priority)) throw new BadRequestException({ error: "Invalid priority" });

    const intake = await this.requireIntake(projectId);

    // Ensure a Triage state exists (create it exactly as Django does when missing).
    let triage = await this.repo.findTriageState(projectId);
    if (!triage) triage = await this.repo.createTriageState(projectId, intake.workspaceId);

    // 1) create the issue in the triage state
    const issue = await this.issueRepo.createIssue(projectId, {
      name: inner.name,
      stateId: triage.id,
      priority,
      descriptionHtml: inner.description_html,
      descriptionJson: inner.description,
      startDate: inner.start_date,
      targetDate: inner.target_date,
      estimatePointId: inner.estimate_point,
      parentId: inner.parent,
      assignees: inner.assignees,
      labels: inner.labels,
    });

    // 2) create the linking intake_issue row
    const intakeIssue = await this.repo.createIntakeIssue({
      intakeId: intake.id,
      projectId,
      workspaceId: intake.workspaceId,
      issueId: issue.id,
      source: "IN_APP",
      status: INTAKE_ISSUE_STATUS.PENDING,
    });

    // 3) issue activity (issue_description_version_task is deferred — not yet ported)
    this.enqueueIssueActivity("issue.activity.created", projectId, issue.id, intakeIssue.id, dto, true);

    return this.buildDetail(intakeIssue, issue);
  }

  /** pk is the *issue* id (Django keys intake-issue routes off issue_id). */
  async retrieveIntakeIssue(projectId: string, pk: string): Promise<IntakeIssueDetailDTO> {
    const intake = await this.requireIntake(projectId);
    const intakeIssue = await this.repo.findByIssue(projectId, intake.id, pk);
    if (!intakeIssue) throw new NotFoundException("The required object does not exist.");
    const issue = await this.issueRepo.findInProject(projectId, pk);
    if (!issue) throw new NotFoundException("The required object does not exist.");
    return this.buildDetail(intakeIssue, issue);
  }

  async updateIntakeIssue(
    projectId: string,
    pk: string,
    dto: UpdateIntakeIssueDto,
  ): Promise<IntakeIssueDetailDTO> {
    const intake = await this.requireIntake(projectId);
    const intakeIssue = await this.repo.findByIssue(projectId, intake.id, pk);
    if (!intakeIssue) throw new NotFoundException("The required object does not exist.");
    let issue = await this.issueRepo.findInProject(projectId, pk);
    if (!issue) throw new NotFoundException("The required object does not exist.");

    // (a) update the underlying issue when an `issue` payload is supplied
    const inner = dto.issue;
    if (inner && Object.keys(inner).length > 0) {
      const patch: Partial<Issue> = {};
      if (inner.name !== undefined) patch.name = inner.name;
      if (inner.priority !== undefined) patch.priority = inner.priority as Issue["priority"];
      if (inner.start_date !== undefined) patch.startDate = inner.start_date;
      if (inner.target_date !== undefined) patch.targetDate = inner.target_date;
      if (inner.estimate_point !== undefined) patch.estimatePointId = inner.estimate_point;
      if (inner.parent !== undefined) patch.parentId = inner.parent;
      if (inner.description !== undefined) patch.descriptionJson = inner.description;
      if (inner.description_html !== undefined) {
        patch.descriptionHtml = inner.description_html;
        patch.descriptionStripped = stripHtml(inner.description_html);
      }
      const updated = await this.issueRepo.updateIssue(issue.id, patch);
      if (updated) issue = updated;
      this.enqueueIssueActivity("issue.activity.updated", projectId, issue.id, intakeIssue.id, inner, true);
    }

    // (b) update the intake-issue fields when supplied
    const hasIntakeFields =
      dto.status !== undefined ||
      dto.snoozed_till !== undefined ||
      dto.duplicate_to !== undefined ||
      dto.source !== undefined;

    if (hasIntakeFields) {
      // Accepting (status = 1) requires a default state when the issue is still in TRIAGE.
      let defaultState: { id: string; group: string | null } | null = null;
      const acceptingFromTriage =
        dto.status === INTAKE_ISSUE_STATUS.ACCEPTED &&
        issue.stateId != null &&
        (await this.issueRepo.getStateGroup(issue.stateId)) === "triage";

      if (dto.status === INTAKE_ISSUE_STATUS.ACCEPTED && acceptingFromTriage) {
        defaultState = await this.repo.findDefaultState(projectId);
        if (!defaultState) {
          throw new BadRequestException({ status: "Cannot accept intake issue: No default state found for the project" });
        }
      }

      const patch: Partial<IntakeIssue> = {};
      if (dto.status !== undefined) patch.status = dto.status as IntakeIssueStatus;
      if (dto.snoozed_till !== undefined) patch.snoozedTill = dto.snoozed_till ? new Date(dto.snoozed_till) : null;
      if (dto.duplicate_to !== undefined) patch.duplicateToId = dto.duplicate_to;
      if (dto.source !== undefined) patch.source = dto.source;
      const updatedIntakeIssue = await this.repo.updateIntakeIssue(intakeIssue.id, patch);

      // On accept, transition the issue from TRIAGE to the project's default state.
      if (defaultState) {
        const moved = await this.issueRepo.updateIssue(issue.id, {
          stateId: defaultState.id,
          completedAt: defaultState.group === "completed" ? new Date() : null,
        });
        if (moved) issue = moved;
      }

      this.enqueueIssueActivity("intake.activity.created", projectId, issue.id, intakeIssue.id, dto, false);
      return this.buildDetail(updatedIntakeIssue ?? intakeIssue, issue);
    }

    return this.buildDetail(intakeIssue, issue);
  }

  async destroyIntakeIssue(projectId: string, pk: string): Promise<void> {
    const intake = await this.requireIntake(projectId);
    const intakeIssue = await this.repo.findByIssue(projectId, intake.id, pk);
    if (!intakeIssue) throw new NotFoundException("The required object does not exist.");

    // Any status other than ACCEPTED (1) deletes the underlying issue too.
    if (intakeIssue.status !== INTAKE_ISSUE_STATUS.ACCEPTED) {
      const issue = await this.issueRepo.findInProject(projectId, pk);
      if (issue) await this.issueRepo.softDelete(issue.id);
    }
    await this.repo.softDeleteIntakeIssue(intakeIssue.id);
  }
}
