import { Module } from "@nestjs/common";
import { MAINTENANCE_HANDLERS } from "./maintenance.handlers";
import { MaintenanceRepository } from "./maintenance.repository";

// Worker-side periodic maintenance handlers (discovered via @CeleryTaskHandler; enqueued by beat).
@Module({
  providers: [MaintenanceRepository, ...MAINTENANCE_HANDLERS],
})
export class MaintenanceModule {}
