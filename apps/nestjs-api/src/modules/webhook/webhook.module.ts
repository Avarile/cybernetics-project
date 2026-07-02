import { Module } from "@nestjs/common";
import { ModelActivityHandler } from "./model-activity.handler";
import { WebhookActivityHandler } from "./webhook-activity.handler";
import { WebhookController } from "./webhook.controller";
import { WebhookRepository } from "./webhook.repository";
import { WebhookSendHandler } from "./webhook-send.handler";
import { WebhookService } from "./webhook.service";

@Module({
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookRepository,
    ModelActivityHandler,
    WebhookActivityHandler,
    WebhookSendHandler,
  ],
  exports: [WebhookRepository],
})
export class WebhookModule {}
