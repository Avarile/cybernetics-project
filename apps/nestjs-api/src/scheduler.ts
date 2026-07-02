import "dotenv/config";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { beatSchedule } from "./infra/scheduler/beat-schedule";
import { RabbitMqScheduler } from "./infra/scheduler/scheduler.service";

// RUN MODE 3 — beat scheduler (RabbitMQ-backed distributed scheduler; replaces @nestjs/schedule).
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  await app.get(RabbitMqScheduler).start(beatSchedule());
  new Logger("scheduler").log("nestjs-api RabbitMQ scheduler started");
}

void bootstrap();
