import { Injectable, Logger } from "@nestjs/common";
import type { CeleryKwargs } from "../../infra/queue/celery-message";
import { CeleryProducer } from "../../infra/queue/celery-producer.service";
import { CeleryTaskHandler } from "../../infra/queue/celery-task.decorator";
import type { TaskHandler } from "../../infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { type ActivityCtx, type BaseFields, dispatchActivity, isValidUuid } from "./activity.mappers";
import { ActivityRepository } from "./activity.repository";
import type { IssueActivityRow } from "./activity.schema";

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * Worker-side port of plane/bgtasks/issue_activities_task.py::issue_activity — the audit "spine".
 *
 * Discovered by TaskHandlerRegistry via @CeleryTaskHandler. Given a Celery message it diffs
 * requested_data vs current_instance (both raw JSON strings, exactly as Django sends them), writes
 * IssueActivity rows through ACTIVITY_MAPPER, then — when notification is truthy — enqueues the
 * notifications task with the same kwargs shape Django's notifications.delay(...) uses.
 */
@CeleryTaskHandler()
@Injectable()
export class IssueActivityHandler implements TaskHandler {
  readonly name = CELERY_TASKS.issueActivity;
  private readonly logger = new Logger(IssueActivityHandler.name);

  constructor(
    private readonly repo: ActivityRepository,
    private readonly celery: CeleryProducer,
  ) {}

  async run(kwargs: CeleryKwargs): Promise<void> {
    try {
      const type = str(kwargs.type);
      const issueId = str(kwargs.issue_id);
      const actorId = str(kwargs.actor_id);
      const projectId = str(kwargs.project_id);
      const epochRaw = kwargs.epoch === null || kwargs.epoch === undefined ? null : Number(kwargs.epoch);
      const epoch = epochRaw !== null && Number.isNaN(epochRaw) ? null : epochRaw;
      if (!type || !projectId || !isValidUuid(projectId)) return;

      const workspaceId = await this.repo.workspaceIdForProject(projectId);
      if (!workspaceId) return;

      // issue_activity() bumps issue.updated_at up front on every change. (origin->redis is skipped;
      // TODO(phase3): set redis key issue_id=origin for the live/websocket attribution layer.)
      if (issueId) {
        try {
          await this.repo.touchIssue(issueId);
        } catch {
          /* mirror Django's best-effort try/except around the touch */
        }
      }

      const base: BaseFields = { projectId, workspaceId, issueId, actorId, epoch };
      const ctx: ActivityCtx = { repo: this.repo, base, rows: [] };

      await dispatchActivity(type, ctx, kwargs.requested_data, kwargs.current_instance);

      const created = await this.repo.bulkInsert(ctx.rows);

      if (kwargs.notification) {
        await this.enqueueNotifications(kwargs, type, base, created);
      }
    } catch (e) {
      // Django wraps the whole task in try/except + log_exception and swallows failures.
      this.logger.error(`issue_activity failed: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  private async enqueueNotifications(
    kwargs: CeleryKwargs,
    type: string,
    base: BaseFields,
    created: IssueActivityRow[],
  ): Promise<void> {
    // Mirrors notifications.delay(type, issue_id, actor_id, project_id, subscriber,
    //   issue_activities_created=json.dumps(IssueActivitySerializer(...).data), requested_data, current_instance)
    await this.celery.enqueue(CELERY_TASKS.notifications, {
      type,
      issue_id: base.issueId,
      actor_id: base.actorId,
      project_id: base.projectId,
      subscriber: kwargs.subscriber ?? true,
      issue_activities_created: JSON.stringify(created.map(serializeActivity)),
      requested_data: kwargs.requested_data ?? null,
      current_instance: kwargs.current_instance ?? null,
    });
  }
}

/**
 * IssueActivitySerializer(many=True).data shape (fields="__all__"). The *_detail nested objects
 * (actor_detail/issue_detail/project_detail/workspace_detail/source_data) are omitted — they require
 * joins the notifications handler can re-resolve. TODO(phase3): include them if needed downstream.
 */
function serializeActivity(row: IssueActivityRow): Record<string, unknown> {
  return {
    id: row.id,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    created_by: row.createdBy,
    updated_by: row.updatedBy,
    deleted_at: row.deletedAt,
    project: row.projectId,
    workspace: row.workspaceId,
    issue: row.issueId,
    verb: row.verb,
    field: row.field,
    old_value: row.oldValue,
    new_value: row.newValue,
    comment: row.comment,
    attachments: row.attachments,
    issue_comment: row.issueCommentId,
    actor: row.actorId,
    old_identifier: row.oldIdentifier,
    new_identifier: row.newIdentifier,
    epoch: row.epoch,
  };
}
