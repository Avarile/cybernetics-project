import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { CeleryProducer } from "./celery-producer.service";
import { CeleryWorker } from "./celery-worker.service";
import { TaskHandlerRegistry } from "./task-handler.registry";

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [CeleryProducer, CeleryWorker, TaskHandlerRegistry],
  exports: [CeleryProducer, CeleryWorker, TaskHandlerRegistry],
})
export class QueueModule {}
