import { Inject, Injectable } from "@nestjs/common";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { apiActivityLogs } from "../maintenance/maintenance.schema";

type Dict = Record<string, unknown>;
const asText = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));

@Injectable()
export class TelemetryRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insertApiLog(logData: Dict): Promise<void> {
    const codeRaw = logData.response_code ?? logData.status_code;
    await this.db.insert(apiActivityLogs).values({
      tokenIdentifier: asText(logData.token_identifier) ?? undefined,
      path: asText(logData.path) ?? undefined,
      method: asText(logData.method) ?? undefined,
      queryParams: (logData.query_params as Dict | undefined) ?? null,
      headers: asText(logData.headers) ?? undefined,
      body: asText(logData.body) ?? undefined,
      responseCode: codeRaw !== undefined && codeRaw !== null ? Number(codeRaw) : undefined,
      responseBody: asText(logData.response_body) ?? undefined,
      ipAddress: asText(logData.ip_address) ?? undefined,
      userAgent: asText(logData.user_agent) ?? undefined,
    });
  }
}
