/**
 * Canonical Celery task names — the single source of truth both Django and NestJS agree on.
 * Values are the exact Django dotted paths so messages route/dispatch identically across workers.
 * (Expand as tasks are ported; see developments/backend/current_design/05-background-jobs.md §3.)
 */
export const CELERY_TASKS = {
  // activity (the spine)
  issueActivity: "plane.bgtasks.issue_activities_task.issue_activity",
  modelActivity: "plane.bgtasks.webhook_task.model_activity",
  // notifications / email
  notifications: "plane.bgtasks.notification_task.notifications",
  stackEmailNotification: "plane.bgtasks.email_notification_task.stack_email_notification",
  sendEmailNotification: "plane.bgtasks.email_notification_task.send_email_notification",
  // webhooks
  webhookActivity: "plane.bgtasks.webhook_task.webhook_activity",
  webhookSend: "plane.bgtasks.webhook_task.webhook_send_task",
  // deletion / cleanup
  softDeleteRelated: "plane.bgtasks.deletion_task.soft_delete_related_objects",
  hardDelete: "plane.bgtasks.deletion_task.hard_delete",
  deleteApiLogs: "plane.bgtasks.cleanup_task.delete_api_logs",
  deleteEmailNotificationLogs: "plane.bgtasks.cleanup_task.delete_email_notification_logs",
  deletePageVersions: "plane.bgtasks.cleanup_task.delete_page_versions",
  deleteIssueDescriptionVersions: "plane.bgtasks.cleanup_task.delete_issue_description_versions",
  deleteWebhookLogs: "plane.bgtasks.cleanup_task.delete_webhook_logs",
  // periodic
  archiveAndCloseOldIssues: "plane.bgtasks.issue_automation_task.archive_and_close_old_issues",
  deleteOldS3Link: "plane.bgtasks.exporter_expired_task.delete_old_s3_link",
  deleteUnuploadedFileAsset: "plane.bgtasks.file_asset_task.delete_unuploaded_file_asset",
  pushInstanceMetrics: "plane.license.bgtasks.telemetry_metrics.push_instance_metrics",
  // logging / analytics
  processLogs: "plane.bgtasks.logger_task.process_logs",
  trackEvent: "plane.bgtasks.event_tracking_task.track_event",
  // transactional email
  magicLink: "plane.bgtasks.magic_link_code_task.magic_link",
  forgotPassword: "plane.bgtasks.forgot_password_task.forgot_password",
  workspaceInvitation: "plane.bgtasks.workspace_invitation_task.workspace_invitation",
  projectInvitation: "plane.bgtasks.project_invitation_task.project_invitation",
  userActivationEmail: "plane.bgtasks.user_activation_email_task.user_activation_email",
  userDeactivationEmail: "plane.bgtasks.user_deactivation_email_task.user_deactivation_email",
  emailUpdateMagicCode: "plane.bgtasks.user_email_update_task.send_email_update_magic_code",
  emailUpdateConfirmation: "plane.bgtasks.user_email_update_task.send_email_update_confirmation",
  projectAddUserEmail: "plane.bgtasks.project_add_user_email_task.project_add_user_email",
  sendWebhookDeactivationEmail: "plane.bgtasks.webhook_task.send_webhook_deactivation_email",
} as const;

export type CeleryTaskName = (typeof CELERY_TASKS)[keyof typeof CELERY_TASKS];
