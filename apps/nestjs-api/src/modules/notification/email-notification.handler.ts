import { Injectable, Logger } from "@nestjs/common";
import { MailerService } from "../../infra/mailer/mailer.service";
import { CeleryTaskHandler } from "../../infra/queue/celery-task.decorator";
import type { TaskHandler } from "../../infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { emailTemplates } from "../email/templates";
import { NotificationRepository } from "./notification.repository";
import type { EmailNotificationLog } from "./notification.schema";

/**
 * Port of email_notification_task.stack_email_notification (beat, every 5 min): batch unprocessed
 * EmailNotificationLog rows by receiver, send one digest per receiver, mark processed.
 * NOTE: Django splits stack -> send_email_notification.delay per receiver; here the send is inlined
 * (functionally equivalent). Actual SMTP transport is MailerService (no-ops if EMAIL_HOST unset).
 */
@CeleryTaskHandler()
@Injectable()
export class StackEmailNotificationHandler implements TaskHandler {
  readonly name = CELERY_TASKS.stackEmailNotification;
  private readonly logger = new Logger(StackEmailNotificationHandler.name);

  constructor(
    private readonly repo: NotificationRepository,
    private readonly mailer: MailerService,
  ) {}

  async run(): Promise<void> {
    const logs = await this.repo.listUnprocessedEmailLogs();
    if (!logs.length) return;

    const byReceiver = new Map<string, EmailNotificationLog[]>();
    for (const log of logs) {
      const list = byReceiver.get(log.receiverId) ?? [];
      list.push(log);
      byReceiver.set(log.receiverId, list);
    }

    for (const [receiverId, group] of byReceiver) {
      const email = await this.repo.getUserEmail(receiverId);
      if (!email) continue;
      const items = group.map((l) => this.describe(l));
      await this.mailer.send({ to: email, ...emailTemplates.notificationDigest(group.length, items) });
    }

    await this.repo.markEmailLogsProcessed(logs.map((l) => l.id));
  }

  private describe(log: EmailNotificationLog): string {
    const data = (log.data ?? {}) as { issue?: Record<string, unknown>; issue_activity?: Record<string, unknown> };
    const issue = data.issue ?? {};
    const activity = data.issue_activity ?? {};
    const ref = `${issue.identifier ?? ""}-${issue.sequence_id ?? ""}`;
    const field = activity.field ?? "issue";
    return `${ref} — ${activity.verb ?? "updated"} ${field}: ${activity.old_value ?? ""} → ${activity.new_value ?? ""}`.trim();
  }
}
