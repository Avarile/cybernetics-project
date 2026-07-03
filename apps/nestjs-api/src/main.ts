import "dotenv/config";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { ConfigService } from "./infra/config/config.service";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import express from "express";
import { AppModule } from "./app.module";
import { buildCorsOptions } from "./infra/http/cors";
import { InstanceBootstrapService } from "./infra/database/instance-bootstrap.service";

// RUN MODE 1 — HTTP API.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.use(cookieParser());
  // Django's sign-in/up/out endpoints are form-POSTs (see modules/auth/credentials.controller.ts).
  app.use(express.urlencoded({ extended: true }));
  app.enableCors(buildCorsOptions(config));

  if (process.env.SEED_ON_BOOT !== "0") {
    // Layer 2 only: register + configure the instance. Migrations and the admin seed
    // are deliberately NOT run on boot — those are `db:init`'s job (see src/db-init.ts).
    await app.get(InstanceBootstrapService).run();
  }

  const port = Number(config.get("PORT", 8000));
  await app.listen(port);
  new Logger("bootstrap").log(`nestjs-api HTTP listening on :${port}`);
}

void bootstrap();
