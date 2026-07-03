import { Module } from "@nestjs/common";
import { TELEMETRY_HANDLERS } from "./telemetry.handlers";
import { TelemetryRepository } from "./telemetry.repository";

// Worker-side telemetry/logging handlers (process_logs, track_event, push_instance_metrics).
@Module({
  providers: [TelemetryRepository, ...TELEMETRY_HANDLERS],
})
export class TelemetryModule {}
