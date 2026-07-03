import { describe, it, expect, vi, afterEach } from "vitest";
import type { S3Service } from "../../infra/storage/s3.service";
import { DeleteUnuploadedFileAssetHandler, GetAssetObjectMetadataHandler } from "./asset-task.handlers";
import type { AssetRepository } from "./asset.repository";
import type { FileAsset } from "./asset.schema";

afterEach(() => delete process.env.UNUPLOADED_ASSET_DELETE_DAYS);

describe("asset task handlers", () => {
  it("delete_unuploaded defaults to a 7-day window", async () => {
    const repo = { deleteUnuploadedOlderThan: vi.fn().mockResolvedValue(undefined) } as unknown as AssetRepository;
    await new DeleteUnuploadedFileAssetHandler(repo).run();
    expect(repo.deleteUnuploadedOlderThan).toHaveBeenCalledWith(7);
  });

  it("delete_unuploaded honours UNUPLOADED_ASSET_DELETE_DAYS", async () => {
    process.env.UNUPLOADED_ASSET_DELETE_DAYS = "3";
    const repo = { deleteUnuploadedOlderThan: vi.fn().mockResolvedValue(undefined) } as unknown as AssetRepository;
    await new DeleteUnuploadedFileAssetHandler(repo).run();
    expect(repo.deleteUnuploadedOlderThan).toHaveBeenCalledWith(3);
  });

  it("get_asset_object_metadata stats the object and saves storage_metadata", async () => {
    const repo = {
      findById: vi.fn().mockResolvedValue({ id: "a1", asset: "u/a1.png" } as FileAsset),
      updateStorageMetadata: vi.fn().mockResolvedValue(undefined),
    } as unknown as AssetRepository;
    const s3 = { getObjectMetadata: vi.fn().mockResolvedValue({ size: 1234, etag: "e", contentType: "image/png" }) } as unknown as S3Service;
    await new GetAssetObjectMetadataHandler(repo, s3).run({ asset_id: "a1" });
    expect(s3.getObjectMetadata).toHaveBeenCalledWith("u/a1.png");
    expect(repo.updateStorageMetadata).toHaveBeenCalledWith("a1", expect.objectContaining({ size: 1234 }));
  });

  it("get_asset_object_metadata no-ops for a missing asset", async () => {
    const repo = { findById: vi.fn().mockResolvedValue(null) } as unknown as AssetRepository;
    const s3 = { getObjectMetadata: vi.fn() } as unknown as S3Service;
    await new GetAssetObjectMetadataHandler(repo, s3).run({ asset_id: "missing" });
    expect(s3.getObjectMetadata).not.toHaveBeenCalled();
  });
});
