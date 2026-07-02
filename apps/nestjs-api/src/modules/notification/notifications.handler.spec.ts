import { describe, it, expect, vi } from "vitest";
import { IssueNotificationsHandler } from "./notifications.handler";
import type { NotificationRepository, IssueContext } from "./notification.repository";

const ctx: IssueContext = {
  id: "i1",
  name: "Fix login",
  identifier: "WEB",
  sequenceId: 7,
  stateName: "Todo",
  stateGroup: "unstarted",
  projectId: "p1",
  workspaceId: "w1",
  workspaceSlug: "acme",
  createdBy: "creator",
};

function make(over: Partial<Record<keyof NotificationRepository, unknown>> = {}) {
  const notifs: Record<string, unknown>[] = [];
  const emails: Record<string, unknown>[] = [];
  const added: string[][] = [];
  const repo = {
    getIssueContext: vi.fn().mockResolvedValue(ctx),
    getSubscriberIds: vi.fn().mockResolvedValue(["s1", "actor"]),
    activeProjectMemberIds: vi.fn().mockResolvedValue(new Set(["s1", "m1"])),
    addSubscribers: vi.fn().mockImplementation(async (_p, _w, _i, ids: string[]) => {
      added.push(ids);
    }),
    getPreference: vi.fn().mockResolvedValue(null), // defaults => all true
    isCompletedState: vi.fn().mockResolvedValue(false),
    bulkInsertNotifications: vi.fn().mockImplementation(async (rows: Record<string, unknown>[]) => {
      notifs.push(...rows);
    }),
    bulkInsertEmailLogs: vi.fn().mockImplementation(async (rows: Record<string, unknown>[]) => {
      emails.push(...rows);
    }),
    ...over,
  } as unknown as NotificationRepository;
  return { handler: new IssueNotificationsHandler(repo), repo, notifs, emails, added };
}

const activity = { id: "a1", verb: "updated", field: "name", comment: "updated the name to", actor: "actor", new_value: "New", old_value: "Old" };
const base = { issue_id: "i1", project_id: "p1", actor_id: "actor", issue_activities_created: JSON.stringify([activity]) };

describe("IssueNotificationsHandler", () => {
  it("skips excluded activity types (cycle/module/reaction/vote/draft)", async () => {
    const { handler, repo } = make();
    await handler.run({ ...base, type: "cycle.activity.created" });
    expect(repo.getIssueContext).not.toHaveBeenCalled();
  });

  it("fans out to subscribers excluding the actor, with the Django data payload", async () => {
    const { handler, notifs } = make();
    await handler.run({ ...base, type: "issue.activity.updated" });
    expect(notifs).toHaveLength(1); // s1 only (actor excluded)
    expect(notifs[0]).toMatchObject({
      receiverId: "s1",
      sender: "in_app:issue_activities",
      entityIdentifier: "i1",
      entityName: "issue",
      title: "updated the name to",
      workspaceId: "w1",
      projectId: "p1",
    });
    const data = notifs[0].data as { issue: Record<string, unknown>; issue_activity: Record<string, unknown> };
    expect(data.issue).toMatchObject({ id: "i1", identifier: "WEB", sequence_id: 7, state_group: "unstarted" });
    expect(data.issue_activity).toMatchObject({ field: "name", new_value: "New", old_value: "Old" });
  });

  it("writes a preference-gated email log for a property change", async () => {
    const { handler, emails } = make();
    await handler.run({ ...base, type: "issue.activity.updated" });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ receiverId: "s1", entity: "issue", newValue: "New" });
  });

  it("suppresses the email when the preference is off", async () => {
    const { handler, emails } = make({
      getPreference: vi.fn().mockResolvedValue({ stateChange: false, issueCompleted: false, comment: false, propertyChange: false }),
    });
    await handler.run({ ...base, type: "issue.activity.updated" });
    expect(emails).toHaveLength(0);
  });

  it("promotes a newly-mentioned project member to a subscriber", async () => {
    const html = '<p><mention-component entity_name="user_mention" entity_identifier="m1"></mention-component></p>';
    const { handler, added } = make();
    await handler.run({ ...base, type: "issue.activity.updated", requested_data: JSON.stringify({ description_html: html }) });
    expect(added.flat()).toContain("m1");
  });
});
