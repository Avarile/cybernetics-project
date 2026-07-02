import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

// RUN MODE 3 — beat scheduler. The @nestjs/schedule cron jobs (BeatScheduler) are wired in Phase 4;
// this bootstrap becomes the process that only ENQUEUES the 12 periodic Celery tasks.
async function bootstrap(): Promise<void> {
  await NestFactory.createApplicationContext(AppModule);
  new Logger("scheduler").warn("Beat scheduler runs in Phase 4; no periodic tasks scheduled yet.");
}

void bootstrap();
