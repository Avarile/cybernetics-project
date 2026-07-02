import { Module } from "@nestjs/common";
import { NotificationController } from "./notification.controller";
import { NotificationRepository } from "./notification.repository";
import { NotificationService } from "./notification.service";
import { IssueNotificationsHandler } from "./notifications.handler";

@Module({
  controllers: [NotificationController],
  providers: [NotificationService, NotificationRepository, IssueNotificationsHandler],
  exports: [NotificationRepository],
})
export class NotificationModule {}
