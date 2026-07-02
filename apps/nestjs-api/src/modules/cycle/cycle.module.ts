import { Module } from "@nestjs/common";
import { CycleArchiveController, CycleController } from "./cycle.controller";
import { CycleRepository } from "./cycle.repository";
import { CycleService } from "./cycle.service";

@Module({
  controllers: [CycleController, CycleArchiveController],
  providers: [CycleService, CycleRepository],
  exports: [CycleService, CycleRepository],
})
export class CycleModule {}
