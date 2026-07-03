import { Injectable, Logger } from "@nestjs/common";
import { CeleryTaskHandler } from "../../infra/queue/celery-task.decorator";
import type { CeleryKwargs } from "../../infra/queue/celery-message";
import type { TaskHandler } from "../../infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { TelemetryRepository } from "./telemetry.repository";

/** Port of logger_task.process_logs — persist an external-API request log row. */
@CeleryTaskHandler()
@Injectable()
export class ProcessLogsHandler implements TaskHandler {
  readonly name = CELERY_TASKS.processLogs;
  constructor(private readonly repo: TelemetryRepository) {}
  async run(kwargs: CeleryKwargs): Promise<void> {
    const logData = (kwargs.log_data ?? {}) as Record<string, unknown>;
    if (Object.keys(logData).length) await this.repo.insertApiLog(logData);
  }
}

/** Port of event_tracking_task.track_event — product analytics (PostHog). Stubbed. */
@CeleryTaskHandler()
@Injectable()
export class TrackEventHandler implements TaskHandler {
  readonly name = CELERY_TASKS.trackEvent;
  private readonly logger = new Logger(TrackEventHandler.name);
  // TODO(phase4/7): forward to PostHog (posthog-node) when POSTHOG_API_KEY is configured.
  run(kwargs: CeleryKwargs): Promise<void> {
    this.logger.debug(`track_event ${String(kwargs.event_name ?? "")} (analytics forwarding not configured)`);
    return Promise.resolve();
  }
}

/** Port of license telemetry_metrics.push_instance_metrics — OTEL gauges. Stubbed. */
@CeleryTaskHandler()
@Injectable()
export class PushInstanceMetricsHandler implements TaskHandler {
  readonly name = CELERY_TASKS.pushInstanceMetrics;
  private readonly logger = new Logger(PushInstanceMetricsHandler.name);
  // TODO(phase7): collect instance counts + push via OpenTelemetry OTLP exporter.
  run(): Promise<void> {
    this.logger.debug("push_instance_metrics (OTEL exporter not configured)");
    return Promise.resolve();
  }
}

export const TELEMETRY_HANDLERS = [ProcessLogsHandler, TrackEventHandler, PushInstanceMetricsHandler];
