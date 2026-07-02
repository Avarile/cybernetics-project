import { Injectable } from "@nestjs/common";
import { CeleryProducer } from "../../infra/queue/celery-producer.service";
import { CeleryTaskHandler } from "../../infra/queue/celery-task.decorator";
import type { CeleryKwargs } from "../../infra/queue/celery-message";
import type { TaskHandler } from "../../infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../../infra/queue/tasks";

type Dict = Record<string, unknown>;
const parse = (v: unknown): Dict | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Dict;
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? (v as Dict) : null;
};

/** Port of webhook_task.model_activity: diff requested vs current, fan out webhook_activity per change. */
@CeleryTaskHandler()
@Injectable()
export class ModelActivityHandler implements TaskHandler {
  readonly name = CELERY_TASKS.modelActivity;

  constructor(private readonly celery: CeleryProducer) {}

  async run(kwargs: CeleryKwargs): Promise<void> {
    const modelName = kwargs.model_name;
    const modelId = kwargs.model_id;
    const actorId = kwargs.actor_id ?? null;
    const slug = kwargs.slug;
    const origin = kwargs.origin ?? null;
    if (!modelName || !slug) return;

    const enqueue = (extra: Dict) =>
      this.celery
        .enqueue(CELERY_TASKS.webhookActivity, {
          event: modelName,
          actor_id: actorId,
          slug,
          current_site: origin,
          event_id: modelId,
          old_identifier: null,
          new_identifier: null,
          ...extra,
        })
        .catch(() => undefined);

    if (kwargs.current_instance === null || kwargs.current_instance === undefined) {
      await enqueue({ verb: "created", field: null, old_value: null, new_value: null });
      return;
    }

    const current = parse(kwargs.current_instance);
    const requested = parse(kwargs.requested_data);
    if (!current || !requested) return;
    for (const key of Object.keys(requested)) {
      if (key in current && current[key] !== requested[key]) {
        await enqueue({ verb: "updated", field: key, old_value: current[key], new_value: requested[key] });
      }
    }
  }
}
