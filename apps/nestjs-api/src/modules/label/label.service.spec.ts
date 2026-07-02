import { describe, it, expect, vi } from "vitest";
import { LabelService } from "./label.service";
import type { LabelRepository } from "./label.repository";
import type { Label } from "./label.schema";

function labelRow(over: Partial<Label> = {}): Label {
  return {
    id: "l1",
    projectId: "p1",
    workspaceId: "w1",
    parentId: null,
    name: "Bug",
    color: "#f00",
    description: "",
    sortOrder: 65535,
    externalSource: null,
    externalId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...over,
  } as Label;
}

const svc = (repo: Partial<LabelRepository>) => new LabelService(repo as LabelRepository);

describe("LabelService.create", () => {
  it("rejects a duplicate name (case-insensitive pre-check)", async () => {
    const s = svc({ nameExists: vi.fn().mockResolvedValue(true) });
    await expect(s.create("p1", { name: "bug" })).rejects.toMatchObject({
      response: { error: "Label with the same name already exists in the project" },
    });
  });

  it("computes sort_order = max + 10000 and creates", async () => {
    const create = vi.fn().mockResolvedValue(labelRow({ sortOrder: 75535 }));
    const s = svc({
      nameExists: vi.fn().mockResolvedValue(false),
      maxSortOrder: vi.fn().mockResolvedValue(65535),
      create,
    });
    const result = await s.create("p1", { name: "Feature", color: "#0f0" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 75535, name: "Feature" }));
    expect(result.id).toBe("l1");
  });

  it("maps a DB unique violation to the friendly error", async () => {
    const s = svc({
      nameExists: vi.fn().mockResolvedValue(false),
      maxSortOrder: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockRejectedValue({ code: "23505" }),
    });
    await expect(s.create("p1", { name: "Dup" })).rejects.toMatchObject({
      response: { error: "Label with the same name already exists in the project" },
    });
  });
});

describe("LabelService.update / destroy", () => {
  it("rejects renaming to an existing name (excluding self)", async () => {
    const s = svc({
      findInProject: vi.fn().mockResolvedValue(labelRow()),
      nameExists: vi.fn().mockResolvedValue(true),
    });
    await expect(s.update("p1", "l1", { name: "taken" })).rejects.toMatchObject({
      response: { error: "Label with the same name already exists in the project" },
    });
  });

  it("soft-deletes an existing label", async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const s = svc({ findInProject: vi.fn().mockResolvedValue(labelRow()), softDelete });
    await s.destroy("p1", "l1");
    expect(softDelete).toHaveBeenCalledWith("l1");
  });

  it("404s an unknown label on destroy", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(null) });
    await expect(s.destroy("p1", "x")).rejects.toMatchObject({ response: { message: "The required object does not exist." } });
  });
});
