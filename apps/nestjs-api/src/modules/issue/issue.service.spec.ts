import { describe, it, expect, vi } from "vitest";
import { IssueService } from "./issue.service";
import type { IssueRepository, IssueAnnotations } from "./issue.repository";
import type { CeleryProducer } from "../../infra/queue/celery-producer.service";
import type { RequestContextService } from "../../infra/context/request-context";
import type { Issue } from "./issue.schema";

function issueRow(over: Partial<Issue> = {}): Issue {
  return {
    id: "i1",
    projectId: "p1",
    workspaceId: "w1",
    parentId: null,
    stateId: "s1",
    estimatePointId: null,
    point: null,
    name: "Task",
    descriptionJson: {},
    descriptionHtml: "<p></p>",
    descriptionStripped: null,
    descriptionBinary: null,
    priority: "none",
    startDate: null,
    targetDate: null,
    sequenceId: 1,
    sortOrder: 65535,
    completedAt: null,
    archivedAt: null,
    isDraft: false,
    externalSource: null,
    externalId: null,
    typeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "u1",
    updatedBy: null,
    deletedAt: null,
  } as Issue;
}

const ann: IssueAnnotations = {
  label_ids: ["l1"],
  assignee_ids: ["a1"],
  module_ids: [],
  sub_issues_count: 0,
  attachment_count: 0,
  link_count: 0,
  cycle_id: null,
};

function make(repo: Partial<IssueRepository>) {
  const celery = { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as CeleryProducer;
  const ctx = { userId: "u1", store: { origin: "http://app" } } as unknown as RequestContextService;
  return { svc: new IssueService(repo as IssueRepository, celery, ctx), celery };
}

describe("IssueService.create", () => {
  it("rejects an invalid state_id", async () => {
    const { svc } = make({ stateBelongsToProject: vi.fn().mockResolvedValue(false) });
    await expect(svc.create("acme", "p1", { name: "X", state: "bad-state-uuid" })).rejects.toMatchObject({
      response: { message: "State is not valid please pass a valid state_id" },
    });
  });

  it("creates and enqueues issue.activity.created + model_activity", async () => {
    const issue = issueRow();
    const createIssue = vi.fn().mockResolvedValue(issue);
    const annotate = vi.fn().mockResolvedValue(new Map([["i1", ann]]));
    const { svc, celery } = make({ createIssue, annotate });
    const dto = { name: "Task", assignees: ["a1"], labels: ["l1"] };
    const result = await svc.create("acme", "p1", dto);
    expect(createIssue).toHaveBeenCalledWith("p1", expect.objectContaining({ name: "Task", assignees: ["a1"], labels: ["l1"] }));
    expect(result).toMatchObject({ id: "i1", label_ids: ["l1"], assignee_ids: ["a1"], sub_issues_count: 0 });
    expect((celery.enqueue as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    const taskNames = (celery.enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(taskNames.some((n: string) => n.endsWith("issue_activity"))).toBe(true);
    expect(taskNames.some((n: string) => n.endsWith("model_activity"))).toBe(true);
  });
});

describe("IssueService.retrieve/update/destroy", () => {
  it("404s an unknown issue on retrieve", async () => {
    const { svc } = make({ findInProject: vi.fn().mockResolvedValue(null) });
    await expect(svc.retrieve("p1", "x")).rejects.toMatchObject({ response: { message: "The required object does not exist." } });
  });

  it("recomputes completed_at when moved to a completed state", async () => {
    const issue = issueRow();
    const updateIssue = vi.fn().mockResolvedValue(issueRow({ stateId: "s2", completedAt: new Date() }));
    const { svc } = make({
      findInProject: vi.fn().mockResolvedValue(issue),
      stateBelongsToProject: vi.fn().mockResolvedValue(true),
      getStateGroup: vi.fn().mockResolvedValue("completed"),
      updateIssue,
      annotate: vi.fn().mockResolvedValue(new Map([["i1", ann]])),
    });
    await svc.update("acme", "p1", "i1", { state: "s2" });
    const patch = updateIssue.mock.calls[0][1];
    expect(patch.stateId).toBe("s2");
    expect(patch.completedAt).toBeInstanceOf(Date);
  });

  it("soft-deletes and enqueues activity", async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const { svc, celery } = make({ findInProject: vi.fn().mockResolvedValue(issueRow()), softDelete });
    await svc.destroy("acme", "p1", "i1");
    expect(softDelete).toHaveBeenCalledWith("i1");
    expect((celery.enqueue as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
