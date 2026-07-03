import { Inject, Injectable, Logger } from "@nestjs/common";
import { lte, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { emailNotificationLogs } from "../notification/notification.schema";
import { webhookLogs } from "../webhook/webhook.schema";
import { apiActivityLogs } from "./maintenance.schema";

const cutoff = (days: number): Date => new Date(Date.now() - days * 86_400_000);

// Tables hard-deleted after the retention window, ordered children -> parents so NO ACTION FKs
// (Django on_delete is app-level) don't block. Best-effort per table (skips on FK error).
const HARD_DELETE_TABLES = [
  "issue_activities",
  "issue_labels",
  "issue_assignees",
  "issue_sequences",
  "cycles",
  "modules",
  "issues",
  "issue_views",
  "labels",
  "states",
  "estimate_points",
  "estimates",
  "pages",
  "projects",
  "workspaces",
];

@Injectable()
export class MaintenanceRepository {
  private readonly logger = new Logger(MaintenanceRepository.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async deleteApiLogsOlderThan(days: number): Promise<void> {
    await this.db.delete(apiActivityLogs).where(lte(apiActivityLogs.createdAt, cutoff(days)));
  }

  async deleteEmailLogsSentBefore(days: number): Promise<void> {
    await this.db.delete(emailNotificationLogs).where(lte(emailNotificationLogs.sentAt, cutoff(days)));
  }

  async deleteWebhookLogsOlderThan(days: number): Promise<void> {
    await this.db.delete(webhookLogs).where(lte(webhookLogs.createdAt, cutoff(days)));
  }

  /** Keep the latest `keep` snapshots per partition; delete the rest (window function). */
  async pruneVersions(table: "page_versions" | "issue_description_versions", partition: "page_id" | "issue_id", keep = 20): Promise<void> {
    await this.db.execute(
      sql.raw(
        `DELETE FROM ${table} WHERE id IN (
           SELECT id FROM (
             SELECT id, row_number() OVER (PARTITION BY ${partition} ORDER BY created_at DESC) AS rn FROM ${table}
           ) ranked WHERE ranked.rn > ${keep}
         )`,
      ),
    );
  }

  /** Purge rows soft-deleted longer ago than `days`, children first (best-effort per table). */
  async hardDelete(days: number): Promise<void> {
    const iso = cutoff(days).toISOString();
    for (const table of HARD_DELETE_TABLES) {
      try {
        await this.db.execute(sql.raw(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < '${iso}'`));
      } catch (e) {
        this.logger.warn(`hard_delete skipped ${table}: ${(e as Error).message}`);
      }
    }
  }
}
