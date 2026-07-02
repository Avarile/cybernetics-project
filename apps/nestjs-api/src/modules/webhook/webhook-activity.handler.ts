import { Injectable } from "@nestjs/common";
import { CeleryProducer } from "../../infra/queue/celery-producer.service";
import { CeleryTaskHandler } from "../../infra/queue/celery-task.decorator";
import type { CeleryKwargs } from "../../infra/queue/celery-message";
import type { TaskHandler } from "../../infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { WebhookRepository } from "./webhook.repository";

/** Port of webhook_task.webhook_activity: resolve active webhooks for the event, fan out sends. */
@CeleryTaskHandler()
@Injectable()
export class WebhookActivityHandler implements TaskHandler {
  readonly name = CELERY_TASKS.webhookActivity;

  constructor(
    private readonly repo: WebhookRepository,
    private readonly celery: CeleryProducer,
  ) {}

  async run(kwargs: CeleryKwargs): Promise<void> {
    const event = kwargs.event ? String(kwargs.event) : null;
    const slug = kwargs.slug ? String(kwargs.slug) : null;
    if (!event || !slug) return;

    const hooks = await this.repo.findActiveForEvent(slug, event);
    for (const wh of hooks) {
      await this.celery
        .enqueue(CELERY_TASKS.webhookSend, {
          webhook_id: wh.id,
          slug,
          event,
          action: kwargs.verb ?? null,
          // TODO(phase3): full get_model_data entity serialization; currently the id + change delta.
          event_data: kwargs.verb === "deleted" ? { id: kwargs.event_id } : { id: kwargs.event_id },
          current_site: kwargs.current_site ?? null,
          activity: {
            field: kwargs.field ?? null,
            new_value: kwargs.new_value ?? null,
            old_value: kwargs.old_value ?? null,
            actor: { id: kwargs.actor_id ?? null },
            old_identifier: kwargs.old_identifier ?? null,
            new_identifier: kwargs.new_identifier ?? null,
          },
        })
        .catch(() => undefined);
    }
  }
}
