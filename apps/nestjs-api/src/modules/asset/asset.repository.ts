import { Inject, Injectable } from "@nestjs/common";
import { and, eq, lt } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { fileAssets, type FileAsset } from "./asset.schema";

@Injectable()
export class AssetRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async deleteUnuploadedOlderThan(days: number): Promise<void> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    await this.db.delete(fileAssets).where(and(eq(fileAssets.isUploaded, false), lt(fileAssets.createdAt, cutoff)));
  }

  async findById(id: string): Promise<FileAsset | null> {
    const [row] = await this.db.select().from(fileAssets).where(eq(fileAssets.id, id)).limit(1);
    return row ?? null;
  }

  async updateStorageMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await this.db.update(fileAssets).set({ storageMetadata: metadata }).where(eq(fileAssets.id, id));
  }
}
