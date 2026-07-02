import { describe, expect, it, vi } from "vitest";
import { ModuleService } from "./module.service";
import type { ModuleRepository } from "./module.repository";
import type { Module } from "./module.schema";

function moduleRow(over: Partial<Module> = {}): Module {
  return {
    id: "m1",
    projectId: "p1",
    workspaceId: "w1",
    name: "Sprint 1",
    description: "",
    descriptionText: null,
    descriptionHtml: null,
    startDate: null,
    targetDate: null,
    status: "planned",
    leadId: null,
    viewProps: {},
    sortOrder: 65535,
    externalSource: null,
    externalId: null,
    archivedAt: null,
    logoProps: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...over,
  } as Module;
}

const svc = (repo: Partial<ModuleRepository>) => new ModuleService(repo as ModuleRepository);

describe("ModuleService.create", () => {
  it("rejects start_date after target_date", async () => {
    const s = svc({});
    await expect(
      s.create("p1", { name: "S", start_date: "2026-02-01", target_date: "2026-01-01" }),
    ).rejects.toMatchObject({ response: { message: "Start date cannot exceed target date", statusCode: 400 } });
  });

  it("rejects a duplicate name up front", async () => {
    const s = svc({ nameExists: vi.fn().mockResolvedValue(true) });
    await expect(s.create("p1", { name: "Dup" })).rejects.toMatchObject({
      response: { error: "Module with this name already exists" },
    });
  });

  it("computes sort_order = min - 10000 and creates", async () => {
    const create = vi.fn().mockResolvedValue(moduleRow({ sortOrder: 55535 }));
    const s = svc({
      nameExists: vi.fn().mockResolvedValue(false),
      minSortOrder: vi.fn().mockResolvedValue(65535),
      create,
      memberIds: vi.fn().mockResolvedValue([]),
    });
    await s.create("p1", { name: "Sprint 2" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 55535, status: "planned" }));
  });

  it("defaults sort_order to 65535 when there are no modules", async () => {
    const create = vi.fn().mockResolvedValue(moduleRow());
    const s = svc({
      nameExists: vi.fn().mockResolvedValue(false),
      minSortOrder: vi.fn().mockResolvedValue(null),
      create,
      memberIds: vi.fn().mockResolvedValue([]),
    });
    await s.create("p1", { name: "First" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 65535 }));
  });

  it("replaces members when member_ids is provided", async () => {
    const module = moduleRow();
    const replaceMembers = vi.fn().mockResolvedValue(undefined);
    const s = svc({
      nameExists: vi.fn().mockResolvedValue(false),
      minSortOrder: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(module),
      replaceMembers,
      memberIds: vi.fn().mockResolvedValue(["u1", "u2"]),
    });
    const result = await s.create("p1", { name: "M", member_ids: ["u1", "u2"] });
    expect(replaceMembers).toHaveBeenCalledWith(module, ["u1", "u2"]);
    expect(result.member_ids).toEqual(["u1", "u2"]);
  });

  it("maps a unique violation to a friendly name error", async () => {
    const s = svc({
      nameExists: vi.fn().mockResolvedValue(false),
      minSortOrder: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockRejectedValue({ code: "23505" }),
    });
    await expect(s.create("p1", { name: "Race" })).rejects.toMatchObject({
      response: { error: "Module with this name already exists" },
    });
  });
});

describe("ModuleService.update", () => {
  it("404s when the module does not exist", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(null) });
    await expect(s.update("p1", "m1", { name: "X" })).rejects.toMatchObject({
      response: { error: "Module not found" },
    });
  });

  it("refuses to update an archived module", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(moduleRow({ archivedAt: new Date() })) });
    await expect(s.update("p1", "m1", { name: "X" })).rejects.toMatchObject({
      response: { error: "Archived module cannot be updated" },
    });
  });

  it("rejects a duplicate name (excluding self)", async () => {
    const s = svc({
      findInProject: vi.fn().mockResolvedValue(moduleRow()),
      nameExists: vi.fn().mockResolvedValue(true),
    });
    await expect(s.update("p1", "m1", { name: "Taken" })).rejects.toMatchObject({
      response: { error: "Module with this name already exists" },
    });
  });
});

describe("ModuleService.archive", () => {
  it("rejects archiving a module that is not completed/cancelled", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(moduleRow({ status: "in-progress" })) });
    await expect(s.archive("p1", "m1")).rejects.toMatchObject({
      response: { error: "Only completed or cancelled modules can be archived" },
    });
  });

  it("sets archived_at for a completed module", async () => {
    const setArchived = vi.fn().mockResolvedValue(moduleRow());
    const s = svc({ findInProject: vi.fn().mockResolvedValue(moduleRow({ status: "completed" })), setArchived });
    const result = await s.archive("p1", "m1");
    expect(setArchived).toHaveBeenCalledWith("m1", expect.any(Date));
    expect(result.archived_at).toEqual(expect.any(String));
  });
});

describe("ModuleService.unarchive", () => {
  it("clears archived_at", async () => {
    const setArchived = vi.fn().mockResolvedValue(moduleRow());
    const s = svc({ findInProject: vi.fn().mockResolvedValue(moduleRow({ archivedAt: new Date() })), setArchived });
    await s.unarchive("p1", "m1");
    expect(setArchived).toHaveBeenCalledWith("m1", null);
  });
});

describe("ModuleService.destroy", () => {
  it("soft-deletes the module", async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const s = svc({ findInProject: vi.fn().mockResolvedValue(moduleRow()), softDelete });
    await s.destroy("p1", "m1");
    expect(softDelete).toHaveBeenCalledWith("m1");
  });
});

describe("ModuleService.list", () => {
  it("attaches member ids per module", async () => {
    const rows = [moduleRow({ id: "a" }), moduleRow({ id: "b" })];
    const s = svc({
      listByProject: vi.fn().mockResolvedValue(rows),
      memberIdsByModules: vi.fn().mockResolvedValue(new Map([["a", ["u1"]]])),
    });
    const result = await s.list("p1");
    expect(result.find((r) => r.id === "a")?.member_ids).toEqual(["u1"]);
    expect(result.find((r) => r.id === "b")?.member_ids).toEqual([]);
  });
});
