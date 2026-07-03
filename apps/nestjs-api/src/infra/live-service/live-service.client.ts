import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { ConfigService } from "../config/config.service";

export interface ConvertedDocument {
  descriptionJson: Record<string, unknown> | null;
  descriptionBinary: Buffer | null;
}

/**
 * Client for the apps/live collaboration service. The API's only call is /convert-document/
 * (plane/bgtasks/copy_s3_object.py::sync_with_external_service): given description_html it returns
 * the ProseMirror JSON + the base64 Yjs binary, which the caller persists onto the entity.
 */
@Injectable()
export class LiveServiceClient {
  private readonly logger = new Logger(LiveServiceClient.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    const base = this.config.get<string>("LIVE_BASE_URL", "http://localhost:3100");
    const path = this.config.get<string>("LIVE_BASE_PATH", "/live/");
    return `${base}${path}`.replace(/\/+$/, "/");
  }

  async convertDocument(descriptionHtml: string, variant: "rich" | "document"): Promise<ConvertedDocument> {
    const res = await axios.post(
      `${this.baseUrl()}convert-document/`,
      { description_html: descriptionHtml, variant },
      { headers: { "Content-Type": "application/json" }, timeout: 30_000 },
    );
    const body = res.data as { description_json?: Record<string, unknown>; description_binary?: string };
    return {
      descriptionJson: body.description_json ?? null,
      descriptionBinary: body.description_binary ? Buffer.from(body.description_binary, "base64") : null,
    };
  }
}
