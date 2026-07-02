import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { workspaces } from "../../infra/database/schema";
import { webhookLogs, webhooks, type Webhook } from "./webhook.schema";

const EVENT_FLAG: Record<string, keyof Pick<Webhook, "project" | "issue" | "module" | "cycle" | "issueComment">> = {
  project: "project",
  issue: "issue",
  module: "module",
  module_issue: "module",
  cycle: "cycle",
  cycle_issue: "cycle",
  issue_comment: "issueComment",
};

@Injectable()
export class WebhookRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findActiveForEvent(slug: string, event: string): Promise<Webhook[]> {
    const rows = await this.db
      .select({ w: webhooks })
      .from(webhooks)
      .innerJoin(workspaces, eq(workspaces.id, webhooks.workspaceId))
      .where(and(eq(workspaces.slug, slug), eq(webhooks.isActive, true), isNull(webhooks.deletedAt)));
    const flag = EVENT_FLAG[event];
    return rows.map((r) => r.w).filter((w) => (flag ? w[flag] === true : true));
  }

  async findById(id: string): Promise<Webhook | null> {
    const [row] = await this.db.select().from(webhooks).where(and(eq(webhooks.id, id), isNull(webhooks.deletedAt))).limit(1);
    return row ?? null;
  }

  async workspaceIdBySlug(slug: string): Promise<string | null> {
    const [row] = await this.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    return row?.id ?? null;
  }

  async listByWorkspace(workspaceId: string): Promise<Webhook[]> {
    return this.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.workspaceId, workspaceId), isNull(webhooks.deletedAt)))
      .orderBy(desc(webhooks.createdAt));
  }

  async findInWorkspace(workspaceId: string, id: string): Promise<Webhook | null> {
    const [row] = await this.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.id, id), isNull(webhooks.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async create(values: typeof webhooks.$inferInsert): Promise<Webhook> {
    const [row] = await this.db.insert(webhooks).values(values).returning();
    return row;
  }

  async update(id: string, values: Partial<typeof webhooks.$inferInsert>): Promise<Webhook | null> {
    const [row] = await this.db.update(webhooks).set(values).where(eq(webhooks.id, id)).returning();
    return row ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db.update(webhooks).set({ deletedAt: new Date() }).where(eq(webhooks.id, id));
  }

  async deactivate(id: string): Promise<void> {
    await this.db.update(webhooks).set({ isActive: false }).where(eq(webhooks.id, id));
  }

  async log(entry: {
    workspaceId: string;
    webhook: string;
    eventType: string;
    requestMethod: string;
    requestHeaders: string;
    requestBody: string;
    responseStatus?: string;
    responseHeaders?: string;
    responseBody?: string;
    retryCount?: number;
  }): Promise<void> {
    await this.db.insert(webhookLogs).values({ ...entry });
  }
}
