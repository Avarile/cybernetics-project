import { Module } from "@nestjs/common";
import { RabbitMqScheduler } from "./scheduler.service";

@Module({
  providers: [RabbitMqScheduler],
  exports: [RabbitMqScheduler],
})
export class SchedulerModule {}
