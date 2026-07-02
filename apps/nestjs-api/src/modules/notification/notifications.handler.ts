import { Injectable, Logger } from "@nestjs/common";
import { CeleryTaskHandler } from "../../infra/queue/celery-task.decorator";
import type { CeleryKwargs } from "../../infra/queue/celery-message";
import type { TaskHandler } from "../../infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { mentionsFromInstance } from "./mentions";
import { NotificationRepository, type IssueContext } from "./notification.repository";
import type { emailNotificationLogs, notifications } from "./notification.schema";

type Activity = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// Types that do NOT generate in-app notifications (plane/bgtasks/notification_task.py).
const EXCLUDED = new Set([
  "cycle.activity.created",
  "cycle.activity.deleted",
  "module.activity.created",
  "module.activity.deleted",
  "issue_reaction.activity.created",
  "issue_reaction.activity.deleted",
  "comment_reaction.activity.created",
  "comment_reaction.activity.deleted",
  "issue_vote.activity.created",
  "issue_vote.activity.deleted",
  "issue_draft.activity.created",
  "issue_draft.activity.updated",
  "issue_draft.activity.deleted",
]);

/**
 * Port of plane/bgtasks/notification_task.py::notifications — fans an activity out to issue
 * subscribers (+ newly-mentioned project members promoted to subscribers), writing in-app
 * Notification rows and preference-gated EmailNotificationLog rows.
 * TODO(phase3): dedicated "in_app:issue_activities:mentioned" notifications + comment-mention parsing.
 */
@CeleryTaskHandler()
@Injectable()
export class IssueNotificationsHandler implements TaskHandler {
  readonly name = CELERY_TASKS.notifications;
  private readonly logger = new Logger(IssueNotificationsHandler.name);

  constructor(private readonly repo: NotificationRepository) {}

  async run(kwargs: CeleryKwargs): Promise<void> {
    try {
      const type = str(kwargs.type);
      const issueId = str(kwargs.issue_id);
      const projectId = str(kwargs.project_id);
      const actorId = str(kwargs.actor_id);
      if (!type || !issueId || !projectId || EXCLUDED.has(type)) return;

      const activities = this.parseActivities(kwargs.issue_activities_created);
      if (!activities.length) return;

      const ctx = await this.repo.getIssueContext(issueId);
      if (!ctx) return;

      await this.promoteMentionSubscribers(kwargs, ctx);

      const subscriberIds = (await this.repo.getSubscriberIds(projectId, issueId, ctx.createdBy)).filter(
        (id) => id !== actorId,
      );
      if (!subscriberIds.length) return;

      const notificationRows: (typeof notifications.$inferInsert)[] = [];
      const emailRows: (typeof emailNotificationLogs.$inferInsert)[] = [];

      for (const subscriberId of subscriberIds) {
        const pref = await this.repo.getPreference(subscriberId, ctx.workspaceId);
        for (const activity of activities) {
          notificationRows.push(this.buildNotification(ctx, activity, actorId, subscriberId));
          if (await this.shouldEmail(projectId, activity, pref)) {
            emailRows.push(this.buildEmailLog(ctx, activity, actorId, subscriberId));
          }
        }
      }

      await this.repo.bulkInsertNotifications(notificationRows);
      await this.repo.bulkInsertEmailLogs(emailRows);
    } catch (e) {
      this.logger.error(`notifications failed: ${(e as Error).message}`);
    }
  }

  private parseActivities(raw: unknown): Activity[] {
    if (raw === null || raw === undefined) return [];
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? (parsed as Activity[]) : [];
    } catch {
      return [];
    }
  }

  private async promoteMentionSubscribers(kwargs: CeleryKwargs, ctx: IssueContext): Promise<void> {
    const mentions = mentionsFromInstance(kwargs.requested_data);
    if (!mentions.length) return;
    const members = await this.repo.activeProjectMemberIds(ctx.projectId);
    const existing = new Set(await this.repo.getSubscriberIds(ctx.projectId, ctx.id, ctx.createdBy));
    const toAdd = mentions.filter((m) => members.has(m) && !existing.has(m));
    await this.repo.addSubscribers(ctx.projectId, ctx.workspaceId, ctx.id, toAdd);
  }

  private issuePayload(ctx: IssueContext): Record<string, unknown> {
    return {
      id: String(ctx.id),
      name: String(ctx.name),
      identifier: String(ctx.identifier ?? ""),
      sequence_id: ctx.sequenceId,
      state_name: ctx.stateName,
      state_group: ctx.stateGroup,
    };
  }

  private activityPayload(activity: Activity): Record<string, unknown> {
    return {
      id: str(activity.id),
      verb: str(activity.verb),
      field: str(activity.field),
      actor: str(activity.actor),
      new_value: str(activity.new_value),
      old_value: str(activity.old_value),
      old_identifier: activity.old_identifier ? String(activity.old_identifier) : null,
      new_identifier: activity.new_identifier ? String(activity.new_identifier) : null,
    };
  }

  private buildNotification(
    ctx: IssueContext,
    activity: Activity,
    actorId: string | null,
    subscriberId: string,
  ): typeof notifications.$inferInsert {
    return {
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      sender: "in_app:issue_activities",
      triggeredById: actorId,
      receiverId: subscriberId,
      entityIdentifier: ctx.id,
      entityName: "issue",
      title: str(activity.comment) ?? "",
      data: { issue: this.issuePayload(ctx), issue_activity: this.activityPayload(activity) },
    };
  }

  private buildEmailLog(
    ctx: IssueContext,
    activity: Activity,
    actorId: string | null,
    subscriberId: string,
  ): typeof emailNotificationLogs.$inferInsert {
    return {
      triggeredById: actorId,
      receiverId: subscriberId,
      entityIdentifier: ctx.id,
      entityName: "issue",
      entity: "issue",
      oldValue: str(activity.old_value)?.slice(0, 300) ?? null,
      newValue: str(activity.new_value)?.slice(0, 300) ?? null,
      data: {
        issue: { ...this.issuePayload(ctx), project_id: ctx.projectId, workspace_slug: ctx.workspaceSlug },
        issue_activity: { ...this.activityPayload(activity), activity_time: activity.created_at ?? null },
      },
    };
  }

  private async shouldEmail(projectId: string, activity: Activity, pref: { stateChange: boolean; issueCompleted: boolean; comment: boolean; propertyChange: boolean } | null): Promise<boolean> {
    const p = pref ?? { stateChange: true, issueCompleted: true, comment: true, propertyChange: true };
    const field = str(activity.field);
    if (field === "state" && p.stateChange) return true;
    if (field === "state" && p.issueCompleted && (await this.repo.isCompletedState(projectId, str(activity.new_identifier)))) return true;
    if (field === "comment" && p.comment) return true;
    if (p.propertyChange) return true;
    return false;
  }
}
