import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { projectMembers, projects, users, workspaces } from "../../infra/database/schema";
import { issueAssignees, issues } from "../issue/issue.schema";
import { states } from "../state/state.schema";
import {
  emailNotificationLogs,
  issueSubscribers,
  notifications,
  userNotificationPreferences,
  type EmailNotificationLog,
  type Notification,
  type UserNotificationPreference,
} from "./notification.schema";

export interface IssueContext {
  id: string;
  name: string;
  identifier: string | null;
  sequenceId: number | null;
  stateName: string | null;
  stateGroup: string | null;
  projectId: string;
  workspaceId: string;
  workspaceSlug: string;
  createdBy: string | null;
}

@Injectable()
export class NotificationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async workspaceIdBySlug(slug: string): Promise<string | null> {
    const [row] = await this.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    return row?.id ?? null;
  }

  async getIssueContext(issueId: string): Promise<IssueContext | null> {
    const [row] = await this.db
      .select({
        id: issues.id,
        name: issues.name,
        sequenceId: issues.sequenceId,
        createdBy: issues.createdBy,
        projectId: issues.projectId,
        workspaceId: issues.workspaceId,
        identifier: projects.identifier,
        workspaceSlug: workspaces.slug,
        stateName: states.name,
        stateGroup: states.group,
      })
      .from(issues)
      .innerJoin(projects, eq(issues.projectId, projects.id))
      .innerJoin(workspaces, eq(issues.workspaceId, workspaces.id))
      .leftJoin(states, eq(issues.stateId, states.id))
      .where(eq(issues.id, issueId))
      .limit(1);
    return row ?? null;
  }

  /** Subscribers = explicit issue_subscribers + assignees + the issue creator (Django auto-subscribes these). */
  async getSubscriberIds(projectId: string, issueId: string, createdBy: string | null): Promise<string[]> {
    const subs = await this.db
      .select({ id: issueSubscribers.subscriberId })
      .from(issueSubscribers)
      .where(and(eq(issueSubscribers.projectId, projectId), eq(issueSubscribers.issueId, issueId), isNull(issueSubscribers.deletedAt)));
    const assignees = await this.db
      .select({ id: issueAssignees.assigneeId })
      .from(issueAssignees)
      .where(and(eq(issueAssignees.projectId, projectId), eq(issueAssignees.issueId, issueId), isNull(issueAssignees.deletedAt)));
    const set = new Set<string>([...subs.map((s) => s.id), ...assignees.map((a) => a.id)]);
    if (createdBy) set.add(createdBy);
    return [...set];
  }

  async activeProjectMemberIds(projectId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ id: projectMembers.memberId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.isActive, true)));
    return new Set(rows.map((r) => r.id));
  }

  async addSubscribers(projectId: string, workspaceId: string, issueId: string, subscriberIds: string[]): Promise<void> {
    if (!subscriberIds.length) return;
    await this.db
      .insert(issueSubscribers)
      .values(subscriberIds.map((subscriberId) => ({ projectId, workspaceId, issueId, subscriberId })))
      .onConflictDoNothing();
  }

  async getPreference(userId: string, workspaceId: string): Promise<UserNotificationPreference | null> {
    const [row] = await this.db
      .select()
      .from(userNotificationPreferences)
      .where(and(eq(userNotificationPreferences.userId, userId), eq(userNotificationPreferences.workspaceId, workspaceId)))
      .limit(1);
    return row ?? null;
  }

  async isCompletedState(projectId: string, stateId: string | null): Promise<boolean> {
    if (!stateId) return false;
    const [row] = await this.db
      .select({ g: states.group })
      .from(states)
      .where(and(eq(states.projectId, projectId), eq(states.id, stateId)))
      .limit(1);
    return row?.g === "completed";
  }

  async bulkInsertNotifications(rows: (typeof notifications.$inferInsert)[]): Promise<void> {
    if (rows.length) await this.db.insert(notifications).values(rows);
  }

  async bulkInsertEmailLogs(rows: (typeof emailNotificationLogs.$inferInsert)[]): Promise<void> {
    if (rows.length) await this.db.insert(emailNotificationLogs).values(rows);
  }

  async listUnprocessedEmailLogs(limit = 1000): Promise<EmailNotificationLog[]> {
    return this.db
      .select()
      .from(emailNotificationLogs)
      .where(isNull(emailNotificationLogs.processedAt))
      .limit(limit);
  }

  async markEmailLogsProcessed(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const now = new Date();
    await this.db
      .update(emailNotificationLogs)
      .set({ processedAt: now, sentAt: now })
      .where(inArray(emailNotificationLogs.id, ids));
  }

  async getUserEmail(userId: string): Promise<string | null> {
    const [row] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.email ?? null;
  }

  // ---- HTTP-facing ----
  listForReceiver(
    receiverId: string,
    workspaceId: string,
    opts: { archived?: boolean; read?: boolean; snoozed?: boolean },
    offset: number,
    limit: number,
  ): Promise<Notification[]> {
    const conds = [eq(notifications.receiverId, receiverId), eq(notifications.workspaceId, workspaceId), isNull(notifications.deletedAt)];
    conds.push(opts.archived ? isNotNull(notifications.archivedAt) : isNull(notifications.archivedAt));
    if (opts.read === true) conds.push(isNotNull(notifications.readAt));
    if (opts.read === false) conds.push(isNull(notifications.readAt));
    if (opts.snoozed === true) conds.push(isNotNull(notifications.snoozedTill));
    return this.db
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt))
      .offset(offset)
      .limit(limit);
  }

  async findForReceiver(receiverId: string, id: string): Promise<Notification | null> {
    const [row] = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.receiverId, receiverId), isNull(notifications.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async setReadAt(id: string, value: Date | null): Promise<void> {
    await this.db.update(notifications).set({ readAt: value }).where(eq(notifications.id, id));
  }

  async setArchivedAt(id: string, value: Date | null): Promise<void> {
    await this.db.update(notifications).set({ archivedAt: value }).where(eq(notifications.id, id));
  }

  async markAllRead(receiverId: string, workspaceId: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.receiverId, receiverId), eq(notifications.workspaceId, workspaceId), isNull(notifications.readAt)));
  }

  async unreadCount(receiverId: string, workspaceId: string): Promise<number> {
    const [row] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.receiverId, receiverId),
          eq(notifications.workspaceId, workspaceId),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
          isNull(notifications.deletedAt),
        ),
      );
    return row?.c ?? 0;
  }
}
