import { CELERY_TASKS } from "../queue/tasks";
import type { ScheduleEntry } from "./scheduler.service";

// The Celery beat schedule (plane/celery.py), reproduced as RabbitMQ-backed schedules.
export function beatSchedule(): ScheduleEntry[] {
  const metricsIntervalMin = Number(process.env.METRICS_PUSH_INTERVAL_MINUTES ?? 360);
  return [
    { name: "stack-email-notification", cron: "*/5 * * * *", task: CELERY_TASKS.stackEmailNotification },
    { name: "push-instance-metrics", intervalMs: metricsIntervalMin * 60_000, task: CELERY_TASKS.pushInstanceMetrics },
    { name: "hard-delete", cron: "0 0 * * *", task: CELERY_TASKS.hardDelete },
    { name: "archive-and-close-old-issues", cron: "0 1 * * *", task: CELERY_TASKS.archiveAndCloseOldIssues },
    { name: "delete-old-s3-link-1", cron: "30 1 * * *", task: CELERY_TASKS.deleteOldS3Link },
    { name: "delete-unuploaded-file-asset", cron: "0 2 * * *", task: CELERY_TASKS.deleteUnuploadedFileAsset },
    { name: "delete-api-logs", cron: "30 2 * * *", task: CELERY_TASKS.deleteApiLogs },
    { name: "delete-email-notification-logs", cron: "45 2 * * *", task: CELERY_TASKS.deleteEmailNotificationLogs },
    { name: "delete-page-versions", cron: "0 3 * * *", task: CELERY_TASKS.deletePageVersions },
    { name: "delete-issue-description-versions", cron: "15 3 * * *", task: CELERY_TASKS.deleteIssueDescriptionVersions },
    { name: "delete-webhook-logs", cron: "30 3 * * *", task: CELERY_TASKS.deleteWebhookLogs },
    { name: "delete-old-s3-link-2", cron: "45 3 * * *", task: CELERY_TASKS.deleteOldS3Link },
  ];
}
