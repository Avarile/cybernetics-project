import { describe, it, expect, vi } from "vitest";
import { IntakeService } from "./intake.service";
import type { IntakeRepository } from "./intake.repository";
import type { IssueRepository, IssueAnnotations } from "../issue/issue.repository";
import type { CeleryProducer } from "../../infra/queue/celery-producer.service";
import type { RequestContextService } from "../../infra/context/request-context";
import type { Issue } from "../issue/issue.schema";
import { INTAKE_ISSUE_STATUS, type Intake, type IntakeIssue } from "./intake.schema";

function intakeRow(over: Partial<Intake> = {}): Intake {
  return {
    id: "intake1",
    projectId: "p1",
    workspaceId: "w1",
    name: "Intake",
    description: "",
    isDefault: false,
    viewProps: {},
    logoProps: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "u1",
    updatedBy: null,
    deletedAt: null,
    ...over,
  } as Intake;
}

function intakeIssueRow(over: Partial<IntakeIssue> = {}): IntakeIssue {
  return {
    id: "ii1",
    projectId: "p1",
    workspaceId: "w1",
    intakeId: "intake1",
    issueId: "i1",
    status: INTAKE_ISSUE_STATUS.PENDING,
    snoozedTill: null,
    duplicateToId: null,
    source: "IN_APP",
    sourceEmail: null,
    externalSource: null,
    externalId: null,
    extra: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "u1",
    updatedBy: null,
    deletedAt: null,
    ...over,
  } as IntakeIssue;
}

function issueRow(over: Partial<Issue> = {}): Issue {
  return {
    id: "i1",
    projectId: "p1",
    workspaceId: "w1",
    parentId: null,
    stateId: "triage1",
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
    ...over,
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

function make(repo: Partial<IntakeRepository>, issueRepo: Partial<IssueRepository> = {}) {
  const celery = { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as CeleryProducer;
  const ctx = { userId: "u1", store: { origin: "http://app" } } as unknown as RequestContextService;
  return {
    svc: new IntakeService(repo as IntakeRepository, issueRepo as IssueRepository, celery, ctx),
    celery,
  };
}

describe("IntakeService.listIntakes", () => {
  it("returns {} when the project has no intake", async () => {
    const { svc } = make({ findFirstForProject: vi.fn().mockResolvedValue(null) });
    await expect(svc.listIntakes("p1")).resolves.toEqual({});
  });

  it("serializes the first intake with pending_issue_count and project_detail", async () => {
    const { svc } = make({
      findFirstForProject: vi.fn().mockResolvedValue(intakeRow()),
      pendingIssueCount: vi.fn().mockResolvedValue(3),
      findProjectLite: vi.fn().mockResolvedValue({ id: "p1", identifier: "PRJ", name: "Proj", description: null }),
    });
    const result = (await svc.listIntakes("p1")) as { pending_issue_count: number; project: string };
    expect(result.pending_issue_count).toBe(3);
    expect(result.project).toBe("p1");
  });
});

describe("IntakeService.createIntake", () => {
  it("maps a unique violation to a friendly name error", async () => {
    const { svc } = make({ create: vi.fn().mockRejectedValue({ code: "23505" }) });
    await expect(svc.createIntake("p1", { name: "Dup" })).rejects.toMatchObject({
      response: { name: "The intake name is already taken" },
    });
  });
});

describe("IntakeService.destroyIntake", () => {
  it("refuses to delete the default intake", async () => {
    const { svc } = make({ findInProject: vi.fn().mockResolvedValue(intakeRow({ isDefault: true })) });
    await expect(svc.destroyIntake("p1", "intake1")).rejects.toMatchObject({
      response: { error: "You cannot delete the default intake" },
    });
  });

  it("soft-deletes a non-default intake", async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const { svc } = make({ findInProject: vi.fn().mockResolvedValue(intakeRow({ isDefault: false })), softDelete });
    await svc.destroyIntake("p1", "intake1");
    expect(softDelete).toHaveBeenCalledWith("intake1");
  });
});

describe("IntakeService.createIntakeIssue", () => {
  it("rejects a missing name", async () => {
    const { svc } = make({});
    await expect(svc.createIntakeIssue("p1", { issue: {} })).rejects.toMatchObject({
      response: { error: "Name is required" },
    });
  });

  it("rejects an invalid priority", async () => {
    const { svc } = make({});
    await expect(
      svc.createIntakeIssue("p1", { issue: { name: "X", priority: "bogus" } }),
    ).rejects.toMatchObject({ response: { error: "Invalid priority" } });
  });

  it("creates the issue in triage, links the intake_issue row, and enqueues issue_activity", async () => {
    const createIssue = vi.fn().mockResolvedValue(issueRow());
    const createIntakeIssue = vi.fn().mockResolvedValue(intakeIssueRow());
    const { svc, celery } = make(
      {
        findFirstForProject: vi.fn().mockResolvedValue(intakeRow()),
        findTriageState: vi.fn().mockResolvedValue({ id: "triage1" }),
        createIntakeIssue,
      },
      {
        createIssue,
        annotate: vi.fn().mockResolvedValue(new Map([["i1", ann]])),
      },
    );

    const result = await svc.createIntakeIssue("p1", { issue: { name: "Task", labels: ["l1"] } });

    expect(createIssue).toHaveBeenCalledWith("p1", expect.objectContaining({ name: "Task", stateId: "triage1", priority: "none" }));
    expect(createIntakeIssue).toHaveBeenCalledWith(
      expect.objectContaining({ intakeId: "intake1", issueId: "i1", source: "IN_APP", status: INTAKE_ISSUE_STATUS.PENDING }),
    );
    const taskNames = (celery.enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(taskNames.some((n: string) => n.endsWith("issue_activity"))).toBe(true);
    expect(result).toMatchObject({ id: "ii1", status: INTAKE_ISSUE_STATUS.PENDING, source: "IN_APP" });
    expect(result.issue).toMatchObject({ id: "i1", label_ids: ["l1"], is_intake: true });
  });

  it("creates a Triage state when the project has none", async () => {
    const createTriageState = vi.fn().mockResolvedValue({ id: "triageNew" });
    const createIssue = vi.fn().mockResolvedValue(issueRow({ stateId: "triageNew" }));
    const { svc } = make(
      {
        findFirstForProject: vi.fn().mockResolvedValue(intakeRow()),
        findTriageState: vi.fn().mockResolvedValue(null),
        createTriageState,
        createIntakeIssue: vi.fn().mockResolvedValue(intakeIssueRow()),
      },
      { createIssue, annotate: vi.fn().mockResolvedValue(new Map([["i1", ann]])) },
    );

    await svc.createIntakeIssue("p1", { issue: { name: "Task" } });
    expect(createTriageState).toHaveBeenCalledWith("p1", "w1");
    expect(createIssue).toHaveBeenCalledWith("p1", expect.objectContaining({ stateId: "triageNew" }));
  });
});

describe("IntakeService.updateIntakeIssue (accept)", () => {
  it("rejects acceptance from triage when the project has no default state", async () => {
    const { svc } = make(
      {
        findFirstForProject: vi.fn().mockResolvedValue(intakeRow()),
        findByIssue: vi.fn().mockResolvedValue(intakeIssueRow()),
        findDefaultState: vi.fn().mockResolvedValue(null),
      },
      {
        findInProject: vi.fn().mockResolvedValue(issueRow({ stateId: "triage1" })),
        getStateGroup: vi.fn().mockResolvedValue("triage"),
      },
    );

    await expect(
      svc.updateIntakeIssue("p1", "i1", { status: INTAKE_ISSUE_STATUS.ACCEPTED }),
    ).rejects.toMatchObject({
      response: { status: "Cannot accept intake issue: No default state found for the project" },
    });
  });

  it("moves the issue from triage to the default state on accept", async () => {
    const updateIssue = vi.fn().mockResolvedValue(issueRow({ stateId: "def1" }));
    const { svc, celery } = make(
      {
        findFirstForProject: vi.fn().mockResolvedValue(intakeRow()),
        findByIssue: vi.fn().mockResolvedValue(intakeIssueRow()),
        findDefaultState: vi.fn().mockResolvedValue({ id: "def1", group: "unstarted" }),
        updateIntakeIssue: vi.fn().mockResolvedValue(intakeIssueRow({ status: INTAKE_ISSUE_STATUS.ACCEPTED })),
      },
      {
        findInProject: vi.fn().mockResolvedValue(issueRow({ stateId: "triage1" })),
        getStateGroup: vi.fn().mockResolvedValue("triage"),
        updateIssue,
        annotate: vi.fn().mockResolvedValue(new Map([["i1", ann]])),
      },
    );

    const result = await svc.updateIntakeIssue("p1", "i1", { status: INTAKE_ISSUE_STATUS.ACCEPTED });
    expect(updateIssue).toHaveBeenCalledWith("i1", expect.objectContaining({ stateId: "def1" }));
    expect(result.status).toBe(INTAKE_ISSUE_STATUS.ACCEPTED);
    const taskNames = (celery.enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(taskNames.some((n: string) => n.endsWith("issue_activity"))).toBe(true);
  });
});

describe("IntakeService.destroyIntakeIssue", () => {
  it("deletes the underlying issue for a non-accepted intake issue", async () => {
    const issueSoftDelete = vi.fn().mockResolvedValue(undefined);
    const softDeleteIntakeIssue = vi.fn().mockResolvedValue(undefined);
    const { svc } = make(
      {
        findFirstForProject: vi.fn().mockResolvedValue(intakeRow()),
        findByIssue: vi.fn().mockResolvedValue(intakeIssueRow({ status: INTAKE_ISSUE_STATUS.PENDING })),
        softDeleteIntakeIssue,
      },
      { findInProject: vi.fn().mockResolvedValue(issueRow()), softDelete: issueSoftDelete },
    );

    await svc.destroyIntakeIssue("p1", "i1");
    expect(issueSoftDelete).toHaveBeenCalledWith("i1");
    expect(softDeleteIntakeIssue).toHaveBeenCalledWith("ii1");
  });

  it("keeps the underlying issue for an accepted intake issue", async () => {
    const issueSoftDelete = vi.fn().mockResolvedValue(undefined);
    const softDeleteIntakeIssue = vi.fn().mockResolvedValue(undefined);
    const { svc } = make(
      {
        findFirstForProject: vi.fn().mockResolvedValue(intakeRow()),
        findByIssue: vi.fn().mockResolvedValue(intakeIssueRow({ status: INTAKE_ISSUE_STATUS.ACCEPTED })),
        softDeleteIntakeIssue,
      },
      { findInProject: vi.fn().mockResolvedValue(issueRow()), softDelete: issueSoftDelete },
    );

    await svc.destroyIntakeIssue("p1", "i1");
    expect(issueSoftDelete).not.toHaveBeenCalled();
    expect(softDeleteIntakeIssue).toHaveBeenCalledWith("ii1");
  });
});
