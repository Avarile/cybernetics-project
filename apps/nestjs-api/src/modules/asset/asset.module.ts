import { Module } from "@nestjs/common";
import { ASSET_HANDLERS } from "./asset-task.handlers";
import { AssetRepository } from "./asset.repository";

// Worker-side asset/S3 task handlers (discovered via @CeleryTaskHandler).
@Module({
  providers: [AssetRepository, ...ASSET_HANDLERS],
  exports: [AssetRepository],
})
export class AssetModule {}
