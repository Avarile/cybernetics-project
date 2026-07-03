import { Injectable, Logger } from "@nestjs/common";
import { CeleryTaskHandler } from "../../infra/queue/celery-task.decorator";
import type { TaskHandler } from "../../infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { MaintenanceRepository } from "./maintenance.repository";

const num = (key: string, fallback: number): number => Number(process.env[key]) || fallback;

@CeleryTaskHandler()
@Injectable()
export class DeleteApiLogsHandler implements TaskHandler {
  readonly name = CELERY_TASKS.deleteApiLogs;
  constructor(private readonly repo: MaintenanceRepository) {}
  run(): Promise<void> {
    return this.repo.deleteApiLogsOlderThan(num("API_ACTIVITY_LOG_RETENTION_DAYS", 14));
  }
}

@CeleryTaskHandler()
@Injectable()
export class DeleteEmailNotificationLogsHandler implements TaskHandler {
  readonly name = CELERY_TASKS.deleteEmailNotificationLogs;
  constructor(private readonly repo: MaintenanceRepository) {}
  run(): Promise<void> {
    return this.repo.deleteEmailLogsSentBefore(num("EMAIL_LOG_RETENTION_DAYS", 7));
  }
}

@CeleryTaskHandler()
@Injectable()
export class DeleteWebhookLogsHandler implements TaskHandler {
  readonly name = CELERY_TASKS.deleteWebhookLogs;
  constructor(private readonly repo: MaintenanceRepository) {}
  run(): Promise<void> {
    return this.repo.deleteWebhookLogsOlderThan(num("WEBHOOK_LOG_RETENTION_DAYS", 14));
  }
}

@CeleryTaskHandler()
@Injectable()
export class DeletePageVersionsHandler implements TaskHandler {
  readonly name = CELERY_TASKS.deletePageVersions;
  constructor(private readonly repo: MaintenanceRepository) {}
  run(): Promise<void> {
    return this.repo.pruneVersions("page_versions", "page_id", 20);
  }
}

@CeleryTaskHandler()
@Injectable()
export class DeleteIssueDescriptionVersionsHandler implements TaskHandler {
  readonly name = CELERY_TASKS.deleteIssueDescriptionVersions;
  constructor(private readonly repo: MaintenanceRepository) {}
  run(): Promise<void> {
    return this.repo.pruneVersions("issue_description_versions", "issue_id", 20);
  }
}

@CeleryTaskHandler()
@Injectable()
export class HardDeleteHandler implements TaskHandler {
  readonly name = CELERY_TASKS.hardDelete;
  constructor(private readonly repo: MaintenanceRepository) {}
  run(): Promise<void> {
    return this.repo.hardDelete(num("HARD_DELETE_AFTER_DAYS", 60));
  }
}

@CeleryTaskHandler()
@Injectable()
export class ArchiveAndCloseOldIssuesHandler implements TaskHandler {
  readonly name = CELERY_TASKS.archiveAndCloseOldIssues;
  private readonly logger = new Logger(ArchiveAndCloseOldIssuesHandler.name);
  // TODO(phase4): port archive_old_issues/close_old_issues — needs projects.archive_in/close_in/
  // default_state_id (not in the current subset project schema) + cycle/module/intake sub-conditions.
  run(): Promise<void> {
    this.logger.debug("archive_and_close_old_issues: not yet ported (needs project automation columns)");
    return Promise.resolve();
  }
}

export const MAINTENANCE_HANDLERS = [
  DeleteApiLogsHandler,
  DeleteEmailNotificationLogsHandler,
  DeleteWebhookLogsHandler,
  DeletePageVersionsHandler,
  DeleteIssueDescriptionVersionsHandler,
  HardDeleteHandler,
  ArchiveAndCloseOldIssuesHandler,
];
