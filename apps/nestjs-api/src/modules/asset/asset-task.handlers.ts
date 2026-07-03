import { Injectable, Logger } from "@nestjs/common";
import { S3Service } from "../../infra/storage/s3.service";
import { CeleryTaskHandler } from "../../infra/queue/celery-task.decorator";
import type { CeleryKwargs } from "../../infra/queue/celery-message";
import type { TaskHandler } from "../../infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { AssetRepository } from "./asset.repository";

/** Port of file_asset_task.delete_unuploaded_file_asset — purge assets never uploaded within the window. */
@CeleryTaskHandler()
@Injectable()
export class DeleteUnuploadedFileAssetHandler implements TaskHandler {
  readonly name = CELERY_TASKS.deleteUnuploadedFileAsset;
  constructor(private readonly repo: AssetRepository) {}
  run(): Promise<void> {
    return this.repo.deleteUnuploadedOlderThan(Number(process.env.UNUPLOADED_ASSET_DELETE_DAYS) || 7);
  }
}

/** Port of storage_metadata_task.get_asset_object_metadata — stat the S3 object, save storage_metadata. */
@CeleryTaskHandler()
@Injectable()
export class GetAssetObjectMetadataHandler implements TaskHandler {
  readonly name = CELERY_TASKS.getAssetObjectMetadata;
  private readonly logger = new Logger(GetAssetObjectMetadataHandler.name);
  constructor(
    private readonly repo: AssetRepository,
    private readonly s3: S3Service,
  ) {}

  async run(kwargs: CeleryKwargs): Promise<void> {
    const assetId = kwargs.asset_id ? String(kwargs.asset_id) : null;
    if (!assetId) return;
    const asset = await this.repo.findById(assetId);
    if (!asset?.asset) return;
    try {
      const metadata = await this.s3.getObjectMetadata(asset.asset);
      await this.repo.updateStorageMetadata(assetId, metadata as unknown as Record<string, unknown>);
    } catch (e) {
      this.logger.warn(`get_asset_object_metadata failed for ${assetId}: ${(e as Error).message}`);
    }
  }
}

export const ASSET_HANDLERS = [DeleteUnuploadedFileAssetHandler, GetAssetObjectMetadataHandler];
