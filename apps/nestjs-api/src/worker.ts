import "dotenv/config";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { CeleryWorker } from "./infra/queue/celery-worker.service";

// RUN MODE 2 — Celery queue consumer (no HTTP listener).
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  await app.get(CeleryWorker).start();
  new Logger("worker").log("nestjs-api Celery worker started");
}

void bootstrap();
