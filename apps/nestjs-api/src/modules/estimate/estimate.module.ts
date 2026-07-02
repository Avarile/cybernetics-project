import { Module } from "@nestjs/common";
import { EstimateController } from "./estimate.controller";
import { EstimateRepository } from "./estimate.repository";
import { EstimateService } from "./estimate.service";

@Module({
  controllers: [EstimateController],
  providers: [EstimateService, EstimateRepository],
  exports: [EstimateService, EstimateRepository],
})
export class EstimateModule {}
