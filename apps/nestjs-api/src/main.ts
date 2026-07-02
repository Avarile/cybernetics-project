import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { buildCorsOptions } from "./infra/http/cors";

// RUN MODE 1 — HTTP API.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.use(cookieParser());
  app.enableCors(buildCorsOptions(config));

  const port = Number(config.get("PORT", 8000));
  await app.listen(port);
  new Logger("bootstrap").log(`nestjs-api HTTP listening on :${port}`);
}

void bootstrap();
