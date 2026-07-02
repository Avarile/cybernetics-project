import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { projectMembers, projects, users, workspaces } from "../../infra/database/schema";
import { webhooks } from "../webhook/webhook.schema";

@Injectable()
export class EmailRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getUser(userId: string): Promise<{ email: string | null; firstName: string | null } | null> {
    const [row] = await this.db
      .select({ email: users.email, firstName: users.firstName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

  async getWorkspace(id: string): Promise<{ name: string; slug: string } | null> {
    const [row] = await this.db.select({ name: workspaces.name, slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
    return row ?? null;
  }

  async getProject(id: string): Promise<{ name: string } | null> {
    const [row] = await this.db.select({ name: projects.name }).from(projects).where(eq(projects.id, id)).limit(1);
    return row ?? null;
  }

  async getProjectMemberUserId(projectMemberId: string): Promise<string | null> {
    const [row] = await this.db.select({ memberId: projectMembers.memberId }).from(projectMembers).where(eq(projectMembers.id, projectMemberId)).limit(1);
    return row?.memberId ?? null;
  }

  async getWebhookUrl(webhookId: string): Promise<string | null> {
    const [row] = await this.db.select({ url: webhooks.url }).from(webhooks).where(eq(webhooks.id, webhookId)).limit(1);
    return row?.url ?? null;
  }
}
