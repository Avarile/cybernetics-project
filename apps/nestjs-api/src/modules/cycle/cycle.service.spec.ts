import { describe, it, expect, vi } from "vitest";
import { CycleService } from "./cycle.service";
import type { CycleRepository } from "./cycle.repository";
import { computeCycleStatus } from "./cycle.serializer";
import type { Cycle } from "./cycle.schema";

const DAY = 24 * 60 * 60 * 1000;

function cycleRow(over: Partial<Cycle> = {}): Cycle {
  return {
    id: "c1",
    projectId: "p1",
    workspaceId: "w1",
    name: "Sprint 1",
    description: "",
    startDate: null,
    endDate: null,
    ownedBy: "u1",
    viewProps: {},
    sortOrder: 65535,
    externalSource: null,
    externalId: null,
    progressSnapshot: {},
    archivedAt: null,
    logoProps: {},
    timezone: "UTC",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...over,
  } as Cycle;
}

function svc(repo: Partial<CycleRepository>) {
  return new CycleService(repo as CycleRepository);
}

describe("CycleService.create", () => {
  it("rejects when only one of start/end date is provided", async () => {
    const s = svc({});
    await expect(s.create("p1", { name: "X", start_date: "2026-01-01T00:00:00Z" }, "u1")).rejects.toMatchObject({
      response: { error: "Both start date and end date are either required or are to be null" },
    });
  });

  it("rejects when start date exceeds end date", async () => {
    const s = svc({ minSortOrder: vi.fn().mockResolvedValue(null) });
    await expect(
      s.create("p1", { name: "X", start_date: "2026-02-01T00:00:00Z", end_date: "2026-01-01T00:00:00Z" }, "u1"),
    ).rejects.toMatchObject({ response: { message: "Start date cannot exceed end date", statusCode: 400 } });
  });

  it("computes sort_order = smallest - 10000 and stamps owned_by", async () => {
    const create = vi.fn().mockResolvedValue(cycleRow({ sortOrder: 55535, ownedBy: "u1" }));
    const s = svc({ minSortOrder: vi.fn().mockResolvedValue(65535), create });
    const result = await s.create("p1", { name: "Sprint 1" }, "u1");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 55535, ownedBy: "u1", projectId: "p1" }));
    expect(result.owned_by_id).toBe("u1");
  });

  it("defaults sort_order to 65535 when the project has no cycles", async () => {
    const create = vi.fn().mockResolvedValue(cycleRow());
    const s = svc({ minSortOrder: vi.fn().mockResolvedValue(null), create });
    await s.create("p1", { name: "Sprint 1" }, "u1");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 65535 }));
  });
});

describe("CycleService.retrieve", () => {
  it("throws 404 when the cycle does not exist", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(null) });
    const err = await s.retrieve("p1", "c1").catch((e) => e);
    expect(err).toMatchObject({ response: { error: "Cycle not found" }, status: 404 });
  });

  it("treats an archived cycle as not found", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(cycleRow({ archivedAt: new Date() })) });
    const err = await s.retrieve("p1", "c1").catch((e) => e);
    expect(err).toMatchObject({ response: { error: "Cycle not found" }, status: 404 });
  });
});

describe("CycleService.update", () => {
  it("refuses to edit an archived cycle", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(cycleRow({ archivedAt: new Date() })) });
    await expect(s.update("p1", "c1", { name: "New" })).rejects.toMatchObject({
      response: { error: "Archived cycle cannot be updated" },
    });
  });

  it("refuses a non-sort-order edit on a completed cycle", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(cycleRow({ endDate: new Date(Date.now() - DAY) })) });
    await expect(s.update("p1", "c1", { name: "New" })).rejects.toMatchObject({
      response: { error: "The Cycle has already been completed so it cannot be edited" },
    });
  });

  it("allows a sort_order-only edit on a completed cycle", async () => {
    const update = vi.fn().mockResolvedValue(cycleRow({ sortOrder: 100 }));
    const s = svc({
      findInProject: vi.fn().mockResolvedValue(cycleRow({ endDate: new Date(Date.now() - DAY) })),
      update,
    });
    await s.update("p1", "c1", { sort_order: 100, name: "ignored" });
    expect(update).toHaveBeenCalledWith("c1", expect.objectContaining({ sortOrder: 100 }));
    expect(update).toHaveBeenCalledWith("c1", expect.not.objectContaining({ name: "ignored" }));
  });
});

describe("CycleService.archive / unarchive", () => {
  it("refuses to archive a cycle that has not completed", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(cycleRow({ endDate: new Date(Date.now() + DAY) })) });
    await expect(s.archive("p1", "c1")).rejects.toMatchObject({
      response: { error: "Only completed cycles can be archived" },
    });
  });

  it("archives a completed cycle and returns archived_at", async () => {
    const update = vi.fn().mockResolvedValue(cycleRow());
    const s = svc({ findInProject: vi.fn().mockResolvedValue(cycleRow({ endDate: new Date(Date.now() - DAY) })), update });
    const result = await s.archive("p1", "c1");
    expect(update).toHaveBeenCalledWith("c1", expect.objectContaining({ archivedAt: expect.any(Date) }));
    expect(typeof result.archived_at).toBe("string");
  });

  it("clears archived_at on unarchive", async () => {
    const update = vi.fn().mockResolvedValue(cycleRow());
    const s = svc({ findInProject: vi.fn().mockResolvedValue(cycleRow({ archivedAt: new Date() })), update });
    await s.unarchive("p1", "c1");
    expect(update).toHaveBeenCalledWith("c1", { archivedAt: null });
  });
});

describe("computeCycleStatus", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("is DRAFT when both dates are null", () => {
    expect(computeCycleStatus(null, null, now)).toBe("DRAFT");
  });

  it("is CURRENT when now is within the range", () => {
    expect(
      computeCycleStatus(new Date("2026-05-01T00:00:00Z"), new Date("2026-07-01T00:00:00Z"), now),
    ).toBe("CURRENT");
  });

  it("is UPCOMING when the start date is in the future", () => {
    expect(
      computeCycleStatus(new Date("2026-07-01T00:00:00Z"), new Date("2026-08-01T00:00:00Z"), now),
    ).toBe("UPCOMING");
  });

  it("is COMPLETED when the end date is in the past", () => {
    expect(
      computeCycleStatus(new Date("2026-04-01T00:00:00Z"), new Date("2026-05-01T00:00:00Z"), now),
    ).toBe("COMPLETED");
  });
});
