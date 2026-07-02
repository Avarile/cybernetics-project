import { describe, it, expect, vi } from "vitest";
import { EstimateService } from "./estimate.service";
import type { EstimateRepository } from "./estimate.repository";
import type { Estimate, EstimatePoint } from "./estimate.schema";

function estimateRow(over: Partial<Estimate> = {}): Estimate {
  return {
    id: "e1",
    projectId: "p1",
    workspaceId: "w1",
    name: "Fibonacci",
    description: "",
    type: "points",
    lastUsed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...over,
  } as Estimate;
}

function pointRow(over: Partial<EstimatePoint> = {}): EstimatePoint {
  return {
    id: "ep1",
    projectId: "p1",
    workspaceId: "w1",
    estimateId: "e1",
    key: 0,
    description: "",
    value: "1",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...over,
  } as EstimatePoint;
}

function svc(repo: Partial<EstimateRepository>) {
  return new EstimateService(repo as EstimateRepository);
}

describe("EstimateService.create", () => {
  it("defaults name (random), type (categories) and creates bulk points", async () => {
    const created = estimateRow({ id: "e9", name: "abcdefghij", type: "categories", workspaceId: "w9" });
    const create = vi.fn().mockResolvedValue(created);
    const bulkCreatePoints = vi.fn().mockResolvedValue([]);
    const listPoints = vi.fn().mockResolvedValue([pointRow({ estimateId: "e9", value: "1" })]);
    const s = svc({ create, bulkCreatePoints, listPoints });

    const result = await s.create("p1", { estimate_points: [{ key: 1, value: "1" }] });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", type: "categories", lastUsed: false }),
    );
    expect((create.mock.calls[0][0] as { name: string }).name).toHaveLength(10);
    expect(bulkCreatePoints).toHaveBeenCalledWith([
      expect.objectContaining({ estimateId: "e9", workspaceId: "w9", key: 1, value: "1", description: "" }),
    ]);
    // Read serializer shape: FK keys are project/workspace (not *_id), plus nested points.
    expect(result.project).toBe("p1");
    expect(result.points).toHaveLength(1);
  });

  it("rejects a point value longer than 20 characters", async () => {
    const s = svc({});
    await expect(
      s.create("p1", { estimate_points: [{ key: 1, value: "x".repeat(21) }] }),
    ).rejects.toMatchObject({ response: { message: expect.stringContaining("20 characters") } });
  });

  it("maps a unique violation to the Django integrity error shape", async () => {
    const create = vi.fn().mockRejectedValue({ code: "23505" });
    const s = svc({ create });
    await expect(s.create("p1", { estimate: { name: "dup" } })).rejects.toMatchObject({
      response: { error: "The payload is not valid" },
    });
  });
});

describe("EstimateService.update", () => {
  it("400s when estimate_points is empty", async () => {
    const s = svc({});
    await expect(s.update("p1", "e1", { estimate_points: [] })).rejects.toMatchObject({
      response: { error: "Estimate points are required" },
    });
  });

  it("updates estimate meta and matching points", async () => {
    const findInProject = vi.fn().mockResolvedValue(estimateRow());
    const updateEstimate = vi.fn().mockResolvedValue(estimateRow({ name: "New", type: "categories" }));
    const findPointsByIds = vi.fn().mockResolvedValue([pointRow({ id: "ep1", value: "1", key: 0 })]);
    const updatePoint = vi.fn().mockResolvedValue(pointRow({ id: "ep1", value: "2", key: 1 }));
    const listPoints = vi.fn().mockResolvedValue([pointRow({ id: "ep1", value: "2", key: 1 })]);
    const s = svc({ findInProject, updateEstimate, findPointsByIds, updatePoint, listPoints });

    const result = await s.update("p1", "e1", {
      estimate: { name: "New", type: "categories" },
      estimate_points: [{ id: "ep1", value: "2", key: 1 }],
    });

    expect(updateEstimate).toHaveBeenCalledWith("e1", expect.objectContaining({ name: "New", type: "categories" }));
    expect(updatePoint).toHaveBeenCalledWith("ep1", { value: "2", key: 1 });
    expect(result.name).toBe("New");
  });

  it("404s when the estimate is missing", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(null) });
    await expect(s.update("p1", "missing", { estimate_points: [{ id: "ep1" }] })).rejects.toMatchObject({
      response: { error: "The required object does not exist." },
    });
  });
});

describe("EstimateService.createPoint", () => {
  it("400s when key is falsy (missing or zero) or value is empty", async () => {
    const s = svc({});
    await expect(s.createPoint("p1", "e1", { key: 0, value: "1" })).rejects.toMatchObject({
      response: { error: "Key and value are required" },
    });
    await expect(s.createPoint("p1", "e1", { key: 1, value: "" })).rejects.toMatchObject({
      response: { error: "Key and value are required" },
    });
  });

  it("404s when the estimate is not found", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(null) });
    await expect(s.createPoint("p1", "e1", { key: 1, value: "1" })).rejects.toMatchObject({
      response: { error: "Estimate not found" },
    });
  });

  it("creates a point scoped to the estimate's workspace", async () => {
    const findInProject = vi.fn().mockResolvedValue(estimateRow({ workspaceId: "w7" }));
    const createPoint = vi.fn().mockResolvedValue(pointRow({ workspaceId: "w7", key: 1, value: "1" }));
    const s = svc({ findInProject, createPoint });
    const result = await s.createPoint("p1", "e1", { key: 1, value: "1" });
    expect(createPoint).toHaveBeenCalledWith(
      expect.objectContaining({ estimateId: "e1", projectId: "p1", workspaceId: "w7", key: 1, value: "1" }),
    );
    expect(result.workspace).toBe("w7");
  });
});

describe("EstimateService.destroyPoint", () => {
  it("re-keys higher points, soft-deletes the point and returns updated points", async () => {
    const points = [
      pointRow({ id: "a", key: 0 }),
      pointRow({ id: "b", key: 1 }),
      pointRow({ id: "c", key: 2 }),
    ];
    const listPoints = vi.fn().mockResolvedValue(points);
    const findPoint = vi.fn().mockResolvedValue(pointRow({ id: "b", key: 1 }));
    const updatePoint = vi.fn().mockImplementation((id: string, patch: { key: number }) =>
      Promise.resolve(pointRow({ id, key: patch.key })),
    );
    const softDeletePoint = vi.fn().mockResolvedValue(undefined);
    const s = svc({ listPoints, findPoint, updatePoint, softDeletePoint });

    const result = await s.destroyPoint("p1", "e1", "b", {});

    // Only point "c" (key 2 > deleted key 1) is decremented.
    expect(updatePoint).toHaveBeenCalledTimes(1);
    expect(updatePoint).toHaveBeenCalledWith("c", { key: 1 });
    expect(softDeletePoint).toHaveBeenCalledWith("b");
    expect(result.map((p) => p.id)).toEqual(["c"]);
  });

  it("404s when the point does not exist", async () => {
    const s = svc({ listPoints: vi.fn().mockResolvedValue([]), findPoint: vi.fn().mockResolvedValue(null) });
    await expect(s.destroyPoint("p1", "e1", "missing", {})).rejects.toMatchObject({
      response: { error: "Estimate point not found" },
    });
  });
});

describe("EstimateService.destroy", () => {
  it("soft-deletes an existing estimate", async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const s = svc({ findInProject: vi.fn().mockResolvedValue(estimateRow()), softDelete });
    await s.destroy("p1", "e1");
    expect(softDelete).toHaveBeenCalledWith("e1");
  });

  it("404s when the estimate is missing", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(null) });
    await expect(s.destroy("p1", "missing")).rejects.toMatchObject({
      response: { error: "The required object does not exist." },
    });
  });
});

describe("EstimateService.projectEstimates", () => {
  it("returns [] when the project has no current estimate", async () => {
    const s = svc({ projectCurrentEstimateId: vi.fn().mockResolvedValue(null) });
    expect(await s.projectEstimates("p1")).toEqual([]);
  });

  it("returns serialized points of the current estimate", async () => {
    const projectCurrentEstimateId = vi.fn().mockResolvedValue("e1");
    const listPoints = vi.fn().mockResolvedValue([pointRow({ id: "ep1" })]);
    const s = svc({ projectCurrentEstimateId, listPoints });
    const result = await s.projectEstimates("p1");
    expect(listPoints).toHaveBeenCalledWith("p1", "e1");
    expect(result).toHaveLength(1);
    expect(result[0].estimate).toBe("e1");
  });
});
