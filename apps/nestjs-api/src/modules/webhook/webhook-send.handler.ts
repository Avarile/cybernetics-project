import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { CeleryTaskHandler } from "../../infra/queue/celery-task.decorator";
import type { CeleryKwargs } from "../../infra/queue/celery-message";
import type { TaskHandler } from "../../infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { isBlockedUrl } from "../../shared/url-guard";
import { WebhookRepository } from "./webhook.repository";
import { signWebhook } from "./webhook.signature";

/**
 * Port of webhook_task.webhook_send_task: sign (HMAC-SHA256 -> X-Plane-Signature) + POST + log.
 * TODO(phase3): full retry/backoff schedule + auto-deactivate-after-N + deactivation email.
 */
@CeleryTaskHandler()
@Injectable()
export class WebhookSendHandler implements TaskHandler {
  readonly name = CELERY_TASKS.webhookSend;
  private readonly logger = new Logger(WebhookSendHandler.name);

  constructor(private readonly repo: WebhookRepository) {}

  async run(kwargs: CeleryKwargs): Promise<void> {
    const webhookId = kwargs.webhook_id ? String(kwargs.webhook_id) : null;
    if (!webhookId) return;
    const webhook = await this.repo.findById(webhookId);
    if (!webhook || !webhook.isActive) return;

    if (isBlockedUrl(webhook.url)) {
      this.logger.warn(`Blocked webhook delivery to internal URL: ${webhook.url}`);
      return;
    }

    const event = String(kwargs.event ?? "");
    const payload = {
      event,
      action: kwargs.action ?? null,
      webhook_id: webhook.id,
      workspace_id: webhook.workspaceId,
      data: kwargs.event_data ?? null,
      activity: kwargs.activity ?? null,
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "PlaneWebhook",
      "X-Plane-Delivery": randomUUID(),
      "X-Plane-Event": event,
      "X-Plane-Signature": signWebhook(webhook.secretKey, body),
    };

    try {
      const res = await axios.post(webhook.url, body, { headers, timeout: 30_000, validateStatus: () => true });
      await this.repo.log({
        workspaceId: webhook.workspaceId,
        webhook: webhook.id,
        eventType: event,
        requestMethod: "POST",
        requestHeaders: JSON.stringify(headers),
        requestBody: body,
        responseStatus: String(res.status),
        responseHeaders: JSON.stringify(res.headers ?? {}),
        responseBody: typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? ""),
      });
    } catch (err) {
      await this.repo.log({
        workspaceId: webhook.workspaceId,
        webhook: webhook.id,
        eventType: event,
        requestMethod: "POST",
        requestHeaders: JSON.stringify(headers),
        requestBody: body,
        responseStatus: "error",
        responseBody: (err as Error).message,
      });
      this.logger.warn(`Webhook ${webhook.id} delivery failed: ${(err as Error).message}`);
    }
  }
}
