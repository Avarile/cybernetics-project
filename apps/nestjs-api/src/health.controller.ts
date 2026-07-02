import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  // Django skips logging GET / (health check). Keep a lightweight liveness endpoint.
  @Get()
  root(): { status: string } {
    return { status: "ok" };
  }

  @Get("health")
  health(): { status: string; service: string } {
    return { status: "ok", service: "nestjs-api" };
  }
}
