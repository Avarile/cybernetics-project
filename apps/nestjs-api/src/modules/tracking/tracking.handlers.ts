import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { CeleryTaskHandler } from "../../infra/queue/celery-task.decorator";
import type { CeleryKwargs } from "../../infra/queue/celery-message";
import type { TaskHandler } from "../../infra/queue/task-handler.registry";
import { CELERY_TASKS } from "../../infra/queue/tasks";
import { isBlockedUrl } from "../../shared/url-guard";
import { TrackingRepository } from "./tracking.repository";

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Extract <title> from HTML (regex; port of the BeautifulSoup title lookup). */
export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].replace(/\s+/g, " ").trim() || null : null;
}

/** Port of recent_visited_task.recent_visited_task. */
@CeleryTaskHandler()
@Injectable()
export class RecentVisitedHandler implements TaskHandler {
  readonly name = CELERY_TASKS.recentVisited;
  constructor(private readonly repo: TrackingRepository) {}
  async run(k: CeleryKwargs): Promise<void> {
    const entityName = str(k.entity_name);
    const entityIdentifier = str(k.entity_identifier);
    const userId = str(k.user_id);
    const slug = str(k.slug);
    if (!entityName || !entityIdentifier || !userId || !slug) return;
    const workspaceId = await this.repo.workspaceIdBySlug(slug);
    if (!workspaceId) return;
    await this.repo.upsertRecentVisit(entityName, entityIdentifier, userId, workspaceId, str(k.project_id));
  }
}

/** Port of work_item_link_task.crawl_work_item_link_title — fetch the page <title> for a pasted link. */
@CeleryTaskHandler()
@Injectable()
export class CrawlWorkItemLinkTitleHandler implements TaskHandler {
  readonly name = CELERY_TASKS.crawlWorkItemLinkTitle;
  private readonly logger = new Logger(CrawlWorkItemLinkTitleHandler.name);
  constructor(private readonly repo: TrackingRepository) {}

  async run(k: CeleryKwargs): Promise<void> {
    const linkId = str(k.link_id) ?? str(k.issue_link_id);
    if (!linkId) return;
    const link = await this.repo.findLink(linkId);
    if (!link?.url || isBlockedUrl(link.url)) return; // SSRF guard (validate_url_ip parity)
    try {
      const res = await axios.get<string>(link.url, { timeout: 10_000, maxRedirects: 5, responseType: "text" });
      const title = extractTitle(typeof res.data === "string" ? res.data : "");
      if (title) await this.repo.updateLinkTitle(linkId, title, { ...(link.metadata ?? {}), title });
    } catch (e) {
      this.logger.warn(`crawl_work_item_link_title failed for ${linkId}: ${(e as Error).message}`);
    }
  }
}

export const TRACKING_HANDLERS = [RecentVisitedHandler, CrawlWorkItemLinkTitleHandler];
