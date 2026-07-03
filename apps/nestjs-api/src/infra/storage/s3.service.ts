import { Injectable, Logger } from "@nestjs/common";
import { Client as MinioClient } from "minio";
import { ConfigService } from "../config/config.service";

export interface ObjectMetadata {
  size: number;
  etag: string;
  contentType?: string;
  lastModified?: Date;
}

/**
 * S3/MinIO object storage (mirrors plane/settings/storage.py::S3Storage). Presigned upload/download
 * for the v2 asset flow, plus stat/copy/remove used by the asset background tasks.
 */
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private client?: MinioClient;
  readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get<string>("AWS_S3_BUCKET_NAME", "uploads");
  }

  private getClient(): MinioClient {
    if (this.client) return this.client;
    const endpointUrl = this.config.get<string>("AWS_S3_ENDPOINT_URL", "http://localhost:9000");
    const url = new URL(endpointUrl);
    this.client = new MinioClient({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      useSSL: url.protocol === "https:",
      accessKey: this.config.get<string>("AWS_ACCESS_KEY_ID", ""),
      secretKey: this.config.get<string>("AWS_SECRET_ACCESS_KEY", ""),
      region: this.config.get<string>("AWS_REGION", "us-east-1"),
    });
    return this.client;
  }

  presignUpload(objectName: string, expirySeconds = 3600): Promise<string> {
    return this.getClient().presignedPutObject(this.bucket, objectName, expirySeconds);
  }

  presignDownload(objectName: string, expirySeconds = 3600): Promise<string> {
    return this.getClient().presignedGetObject(this.bucket, objectName, expirySeconds);
  }

  async getObjectMetadata(objectName: string): Promise<ObjectMetadata> {
    const stat = await this.getClient().statObject(this.bucket, objectName);
    return {
      size: stat.size,
      etag: stat.etag,
      contentType: stat.metaData?.["content-type"],
      lastModified: stat.lastModified,
    };
  }

  copyObject(sourceObject: string, destObject: string): Promise<unknown> {
    // minio copyObject expects a source path "bucket/object"
    return this.getClient().copyObject(this.bucket, destObject, `/${this.bucket}/${sourceObject}`);
  }

  removeObject(objectName: string): Promise<void> {
    return this.getClient().removeObject(this.bucket, objectName);
  }
}
