import { describe, expect, it, vi } from "vitest";
import type { CeleryProducer } from "../../infra/queue/celery-producer.service";
import type { ActivityRepository } from "./activity.repository";
import type { IssueActivityRow, NewIssueActivity } from "./activity.schema";
import { IssueActivityHandler } from "./issue-activity.handler";

// is_valid_uuid() requires v4 UUIDs, and run() rejects a non-uuid project_id — so tests must use
// real v4 uuids everywhere an id is looked up / validated.
const PROJECT = "66666666-6666-4666-8666-666666666666";
const ISSUE = "77777777-7777-4777-8777-777777777777";
const ACTOR = "88888888-8888-4888-8888-888888888888";
const STATE_OLD = "11111111-1111-4111-8111-111111111111";
const STATE_NEW = "22222222-2222-4222-8222-222222222222";
const ASSIGNEE_A = "33333333-3333-4333-8333-333333333333";
const ASSIGNEE_B = "44444444-4444-4444-8444-444444444444";
const LABEL = "55555555-5555-4555-8555-555555555555";

function make(repoOver: Partial<Record<keyof ActivityRepository, unknown>> = {}) {
  const inserted: NewIssueActivity[][] = [];
  const insertedOne: NewIssueActivity[] = [];
  const repo = {
    workspaceIdForProject: vi.fn().mockResolvedValue("w1"),
    touchIssue: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn().mockResolvedValue({ id: ISSUE, createdAt: new Date("2024-01-01T00:00:00Z"), createdBy: ACTOR }),
    issueRef: vi.fn().mockResolvedValue(null),
    getState: vi
      .fn()
      .mockImplementation(async (_p: string, id: string) =>
        id === STATE_OLD ? { id: STATE_OLD, name: "Todo" } : id === STATE_NEW ? { id: STATE_NEW, name: "Done" } : null,
      ),
    getLabel: vi.fn().mockImplementation(async (id: string) => (id === LABEL ? { id: LABEL, name: "Bug" } : null)),
    getUser: vi
      .fn()
      .mockImplementation(async (id: string) =>
        id === ASSIGNEE_A ? { id: ASSIGNEE_A, displayName: "Alice" } : id === ASSIGNEE_B ? { id: ASSIGNEE_B, displayName: "Bob" } : null,
      ),
    getEstimatePoint: vi.fn().mockResolvedValue(null),
    getCycle: vi.fn().mockResolvedValue(null),
    getModule: vi.fn().mockResolvedValue(null),
    lastActivity: vi.fn().mockResolvedValue(null),
    touchActivityCreatedAt: vi.fn().mockResolvedValue(undefined),
    insertOne: vi.fn().mockImplementation(async (row: NewIssueActivity) => {
      insertedOne.push(row);
      return { ...row, id: "created-1" } as IssueActivityRow;
    }),
    bulkInsert: vi.fn().mockImplementation(async (rows: NewIssueActivity[]) => {
      inserted.push(rows);
      return rows.map((r, i) => ({ ...r, id: `a${i}` }) as IssueActivityRow);
    }),
    ...repoOver,
  } as unknown as ActivityRepository;
  const celery = { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as CeleryProducer;
  return { handler: new IssueActivityHandler(repo, celery), repo, celery, inserted, insertedOne };
}

const base = { issue_id: ISSUE, actor_id: ACTOR, project_id: PROJECT, epoch: 1719900000 };
const enqueueMock = (celery: CeleryProducer) => celery.enqueue as unknown as ReturnType<typeof vi.fn>;

describe("IssueActivityHandler", () => {
  it("writes the standalone 'created the issue' row (actor/created_at from the issue)", async () => {
    const { handler, insertedOne } = make();
    await handler.run({ ...base, type: "issue.activity.created", requested_data: JSON.stringify({ name: "X" }) });
    expect(insertedOne[0]).toMatchObject({
      verb: "created",
      comment: "created the issue",
      projectId: PROJECT,
      workspaceId: "w1",
      actorId: ACTOR,
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });
  });

  it("bails out early when project_id is not a valid uuid", async () => {
    const { handler, repo } = make();
    await handler.run({ ...base, project_id: "not-a-uuid", type: "issue.activity.deleted" });
    expect(repo.workspaceIdForProject).not.toHaveBeenCalled();
  });

  it("tracks a name change on update", async () => {
    const { handler, inserted } = make();
    await handler.run({
      ...base,
      type: "issue.activity.updated",
      requested_data: JSON.stringify({ name: "New" }),
      current_instance: JSON.stringify({ name: "Old" }),
    });
    expect(inserted[0]).toContainEqual(
      expect.objectContaining({ field: "name", comment: "updated the name to", oldValue: "Old", newValue: "New", verb: "updated" }),
    );
  });

  it("tracks a state change with resolved names + identifiers", async () => {
    const { handler, inserted } = make();
    await handler.run({
      ...base,
      type: "issue.activity.updated",
      requested_data: JSON.stringify({ state_id: STATE_NEW }),
      current_instance: JSON.stringify({ state_id: STATE_OLD }),
    });
    expect(inserted[0]).toContainEqual(
      expect.objectContaining({
        field: "state",
        comment: "updated the state to",
        oldValue: "Todo",
        newValue: "Done",
        oldIdentifier: STATE_OLD,
        newIdentifier: STATE_NEW,
      }),
    );
  });

  it("resolves label names on add", async () => {
    const { handler, inserted } = make();
    await handler.run({
      ...base,
      type: "issue.activity.updated",
      requested_data: JSON.stringify({ label_ids: [LABEL] }),
      current_instance: JSON.stringify({ label_ids: [] }),
    });
    expect(inserted[0]).toContainEqual(
      expect.objectContaining({ field: "labels", comment: "added label ", newValue: "Bug", newIdentifier: LABEL, oldValue: "" }),
    );
  });

  it("emits an added-assignee row with the resolved display name", async () => {
    const { handler, inserted } = make();
    await handler.run({
      ...base,
      type: "issue.activity.updated",
      requested_data: JSON.stringify({ assignee_ids: [ASSIGNEE_A, ASSIGNEE_B] }),
      current_instance: JSON.stringify({ assignee_ids: [ASSIGNEE_A] }),
    });
    expect(inserted[0]).toContainEqual(
      expect.objectContaining({ field: "assignees", comment: "added assignee ", newValue: "Bob", newIdentifier: ASSIGNEE_B }),
    );
  });

  it("writes a 'deleted the issue' row on delete", async () => {
    const { handler, inserted } = make();
    await handler.run({ ...base, type: "issue.activity.deleted" });
    expect(inserted[0][0]).toMatchObject({ verb: "deleted", field: "issue", comment: "deleted the issue" });
  });

  it("dedupes consecutive description edits by the same actor (touches instead of inserting)", async () => {
    const touchActivityCreatedAt = vi.fn().mockResolvedValue(undefined);
    const { handler, inserted } = make({
      lastActivity: vi.fn().mockResolvedValue({ id: "prev", field: "description", actorId: ACTOR }),
      touchActivityCreatedAt,
    });
    await handler.run({
      ...base,
      type: "issue.activity.updated",
      requested_data: JSON.stringify({ description_html: "<p>new</p>" }),
      current_instance: JSON.stringify({ description_html: "<p>old</p>" }),
    });
    expect(touchActivityCreatedAt).toHaveBeenCalledWith("prev");
    expect(inserted[0]).toHaveLength(0);
  });

  it("enqueues notifications with Django's kwargs shape when notification=true", async () => {
    const { handler, celery } = make();
    const requested = JSON.stringify({ state_id: STATE_NEW });
    const current = JSON.stringify({ state_id: STATE_OLD });
    await handler.run({
      ...base,
      type: "issue.activity.updated",
      requested_data: requested,
      current_instance: current,
      notification: true,
    });
    const [taskName, kwargs] = enqueueMock(celery).mock.calls[0];
    expect(taskName).toBe("plane.bgtasks.notification_task.notifications");
    expect(kwargs).toMatchObject({
      type: "issue.activity.updated",
      issue_id: ISSUE,
      actor_id: ACTOR,
      project_id: PROJECT,
      subscriber: true,
      requested_data: requested,
      current_instance: current,
    });
    // issue_activities_created is a JSON string of the serialized created rows.
    const activities = JSON.parse(kwargs.issue_activities_created as string) as Array<Record<string, unknown>>;
    expect(activities[0]).toMatchObject({ field: "state", new_value: "Done", new_identifier: STATE_NEW });
  });

  it("does not enqueue notifications when notification is falsy", async () => {
    const { handler, celery } = make();
    await handler.run({ ...base, type: "issue.activity.deleted" });
    expect(enqueueMock(celery)).not.toHaveBeenCalled();
  });
});
