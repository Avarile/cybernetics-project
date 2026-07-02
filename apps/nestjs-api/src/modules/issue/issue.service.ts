import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { RequestContextService } from "../../infra/context/request-context";
import { CeleryProducer } from "../../infra/queue/celery-producer.service";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { paginate, type CursorPageParams, type PaginatedResult } from "../../infra/pagination/paginate";
import { stripHtml } from "../../shared/strip-html";
import type { CreateIssueDto, UpdateIssueDto } from "./dto/issue.dto";
import { IssueRepository } from "./issue.repository";
import { serializeIssue, type IssueDTO } from "./issue.serializer";
import type { Issue } from "./issue.schema";

@Injectable()
export class IssueService {
  constructor(
    private readonly repo: IssueRepository,
    private readonly celery: CeleryProducer,
    private readonly ctx: RequestContextService,
  ) {}

  private async serializeOne(issue: Issue): Promise<IssueDTO> {
    const ann = await this.repo.annotate([issue.id]);
    return serializeIssue(issue, ann.get(issue.id)!);
  }

  private enqueueActivity(type: string, slug: string, projectId: string, issueId: string, data: unknown): void {
    const actorId = this.ctx.userId ?? null;
    const origin = this.ctx.store?.origin ?? null;
    const epoch = Math.floor(Date.now() / 1000);
    // fire-and-forget; broker may be down (no result backend, matches Django .delay())
    void this.celery
      .enqueue(CELERY_TASKS.issueActivity, {
        type,
        requested_data: JSON.stringify(data),
        actor_id: actorId,
        issue_id: issueId,
        project_id: projectId,
        current_instance: null,
        epoch,
        notification: true,
        origin,
      })
      .catch(() => undefined);
    void this.celery
      .enqueue(CELERY_TASKS.modelActivity, {
        model_name: "issue",
        model_id: issueId,
        requested_data: data,
        current_instance: null,
        actor_id: actorId,
        slug,
        origin,
      })
      .catch(() => undefined);
  }

  async create(slug: string, projectId: string, dto: CreateIssueDto): Promise<IssueDTO> {
    if (dto.state && !(await this.repo.stateBelongsToProject(projectId, dto.state))) {
      throw new BadRequestException("State is not valid please pass a valid state_id");
    }
    const issue = await this.repo.createIssue(projectId, {
      name: dto.name,
      stateId: dto.state,
      priority: dto.priority,
      descriptionHtml: dto.description_html,
      descriptionJson: dto.description,
      startDate: dto.start_date,
      targetDate: dto.target_date,
      estimatePointId: dto.estimate_point,
      parentId: dto.parent,
      assignees: dto.assignees,
      labels: dto.labels,
      isDraft: dto.is_draft,
    });
    this.enqueueActivity("issue.activity.created", slug, projectId, issue.id, dto);
    return this.serializeOne(issue);
  }

  list(projectId: string, params: CursorPageParams): Promise<PaginatedResult<IssueDTO>> {
    return paginate<IssueDTO>(
      params,
      () => this.repo.countByProject(projectId),
      async ({ offset, limitPlusOne }) => {
        const rows = await this.repo.listByProject(projectId, offset, limitPlusOne);
        const ann = await this.repo.annotate(rows.map((r) => r.id));
        return rows.map((r) => serializeIssue(r, ann.get(r.id)!));
      },
    );
  }

  async retrieve(projectId: string, id: string): Promise<IssueDTO> {
    const issue = await this.repo.findInProject(projectId, id);
    if (!issue) throw new NotFoundException("The required object does not exist.");
    return this.serializeOne(issue);
  }

  async update(slug: string, projectId: string, id: string, dto: UpdateIssueDto): Promise<IssueDTO> {
    const existing = await this.repo.findInProject(projectId, id);
    if (!existing) throw new NotFoundException("The required object does not exist.");
    if (dto.state && !(await this.repo.stateBelongsToProject(projectId, dto.state))) {
      throw new BadRequestException("State is not valid please pass a valid state_id");
    }

    const patch: Partial<Issue> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.priority !== undefined) patch.priority = dto.priority as Issue["priority"];
    if (dto.start_date !== undefined) patch.startDate = dto.start_date;
    if (dto.target_date !== undefined) patch.targetDate = dto.target_date;
    if (dto.estimate_point !== undefined) patch.estimatePointId = dto.estimate_point;
    if (dto.parent !== undefined) patch.parentId = dto.parent;
    if (dto.description !== undefined) patch.descriptionJson = dto.description;
    if (dto.description_html !== undefined) {
      patch.descriptionHtml = dto.description_html;
      patch.descriptionStripped = stripHtml(dto.description_html);
    }
    if (dto.state !== undefined) {
      patch.stateId = dto.state;
      const group = await this.repo.getStateGroup(dto.state);
      patch.completedAt = group === "completed" ? new Date() : null; // _sync_completed_at
    }

    const updated = await this.repo.updateIssue(id, patch);
    this.enqueueActivity("issue.activity.updated", slug, projectId, id, dto);
    return this.serializeOne(updated!);
  }

  async destroy(slug: string, projectId: string, id: string): Promise<void> {
    const issue = await this.repo.findInProject(projectId, id);
    if (!issue) throw new NotFoundException("The required object does not exist.");
    await this.repo.softDelete(id);
    this.enqueueActivity("issue.activity.deleted", slug, projectId, id, { id });
  }
}
