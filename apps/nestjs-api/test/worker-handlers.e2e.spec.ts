// Verifies the worker's TaskHandlerRegistry discovers every @CeleryTaskHandler across the app
// (activity, webhook, notification, transactional email) — the mechanism worker.ts relies on.
process.env.DATABASE_URL ??= "postgresql://plane:plane@localhost:5433/plane_test";
process.env.SECRET_KEY ??= "e2e-test-secret-key";
process.env.REDIS_URL ??= "redis://localhost:6379/0";
process.env.AMQP_URL ??= "amqp://guest:guest@localhost:5672/";

import { INestApplicationContext } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { TaskHandlerRegistry } from "../src/infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../src/infra/queue/tasks";

let app: INestApplicationContext;
let registry: TaskHandlerRegistry;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init(); // runs onModuleInit -> TaskHandlerRegistry discovery
  registry = app.get(TaskHandlerRegistry);
});

afterAll(async () => {
  await app?.close();
});

describe("worker task-handler discovery", () => {
  const expected = [
    CELERY_TASKS.issueActivity,
    CELERY_TASKS.notifications,
    CELERY_TASKS.stackEmailNotification,
    CELERY_TASKS.modelActivity,
    CELERY_TASKS.webhookActivity,
    CELERY_TASKS.webhookSend,
    CELERY_TASKS.magicLink,
    CELERY_TASKS.forgotPassword,
    CELERY_TASKS.workspaceInvitation,
    CELERY_TASKS.projectInvitation,
    CELERY_TASKS.userActivationEmail,
    CELERY_TASKS.sendWebhookDeactivationEmail,
    // Phase 4 maintenance + telemetry
    CELERY_TASKS.deleteApiLogs,
    CELERY_TASKS.deleteEmailNotificationLogs,
    CELERY_TASKS.deleteWebhookLogs,
    CELERY_TASKS.deletePageVersions,
    CELERY_TASKS.deleteIssueDescriptionVersions,
    CELERY_TASKS.hardDelete,
    CELERY_TASKS.archiveAndCloseOldIssues,
    CELERY_TASKS.processLogs,
    CELERY_TASKS.trackEvent,
    CELERY_TASKS.pushInstanceMetrics,
  ];

  it("registers every spine + email handler by its Celery task name", () => {
    for (const name of expected) {
      expect(registry.has(name), `missing handler for ${name}`).toBe(true);
    }
  });

  it("dispatches by exact Django dotted task name", () => {
    const h = registry.get(CELERY_TASKS.issueActivity);
    expect(h?.name).toBe("plane.bgtasks.issue_activities_task.issue_activity");
  });
});
