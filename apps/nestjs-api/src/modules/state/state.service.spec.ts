import { describe, it, expect, vi } from "vitest";
import { StateService } from "./state.service";
import type { StateRepository } from "./state.repository";
import type { State } from "./state.schema";

function stateRow(over: Partial<State> = {}): State {
  return {
    id: "s1",
    projectId: "p1",
    workspaceId: "w1",
    name: "Backlog",
    color: "#fff",
    group: "backlog",
    default: false,
    description: "",
    slug: "backlog",
    sequence: 15000,
    isTriage: false,
    externalSource: null,
    externalId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...over,
  } as State;
}

function svc(repo: Partial<StateRepository>) {
  return new StateService(repo as StateRepository);
}

describe("StateService.create", () => {
  it("rejects a triage group", async () => {
    const s = svc({});
    await expect(s.create("p1", { name: "T", color: "#fff", group: "triage" })).rejects.toMatchObject({
      response: { message: "Cannot create triage state", statusCode: 400 },
    });
  });

  it("computes sequence = maxSequence + 15000 and slugifies the name", async () => {
    const create = vi.fn().mockResolvedValue(stateRow({ name: "In Progress", slug: "in-progress", sequence: 30000 }));
    const s = svc({ maxSequence: vi.fn().mockResolvedValue(15000), create });
    const result = await s.create("p1", { name: "In Progress", color: "#fff" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sequence: 30000, slug: "in-progress", group: "backlog" }));
    expect(result.project_id).toBe("p1");
  });

  it("defaults sequence to 65535 when there are no states", async () => {
    const create = vi.fn().mockResolvedValue(stateRow());
    const s = svc({ maxSequence: vi.fn().mockResolvedValue(null), create });
    await s.create("p1", { name: "Backlog", color: "#fff" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sequence: 65535 }));
  });

  it("maps a unique violation to a friendly name error", async () => {
    const create = vi.fn().mockRejectedValue({ code: "23505" });
    const s = svc({ maxSequence: vi.fn().mockResolvedValue(null), create });
    await expect(s.create("p1", { name: "Dup", color: "#fff" })).rejects.toMatchObject({
      response: { name: "The state name is already taken" },
    });
  });
});

describe("StateService.list", () => {
  it("computes per-group order (index/count)", async () => {
    const rows = [
      stateRow({ id: "a", group: "unstarted" }),
      stateRow({ id: "b", group: "unstarted" }),
      stateRow({ id: "c", group: "started" }),
    ];
    const s = svc({ listByProject: vi.fn().mockResolvedValue(rows) });
    const result = (await s.list("p1", false)) as { id: string; order?: number }[];
    expect(result.find((r) => r.id === "a")?.order).toBe(0.5);
    expect(result.find((r) => r.id === "b")?.order).toBe(1);
    expect(result.find((r) => r.id === "c")?.order).toBe(1);
  });

  it("returns a group->states dict when grouped", async () => {
    const rows = [stateRow({ id: "a", group: "unstarted" }), stateRow({ id: "c", group: "started" })];
    const s = svc({ listByProject: vi.fn().mockResolvedValue(rows) });
    const result = (await s.list("p1", true)) as Record<string, unknown[]>;
    expect(Object.keys(result).sort()).toEqual(["started", "unstarted"]);
    expect(result.unstarted).toHaveLength(1);
  });
});

describe("StateService.destroy", () => {
  it("refuses to delete the default state", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(stateRow({ default: true })) });
    await expect(s.destroy("p1", "s1")).rejects.toMatchObject({
      response: { error: "Default state cannot be deleted" },
    });
  });

  it("soft-deletes a non-default state", async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const s = svc({ findInProject: vi.fn().mockResolvedValue(stateRow({ default: false })), softDelete });
    await s.destroy("p1", "s1");
    expect(softDelete).toHaveBeenCalledWith("s1");
  });
});

describe("StateService.markDefault", () => {
  it("clears existing defaults then sets the new one", async () => {
    const clearDefault = vi.fn().mockResolvedValue(undefined);
    const setDefault = vi.fn().mockResolvedValue(undefined);
    const s = svc({ clearDefault, setDefault });
    await s.markDefault("p1", "s1");
    expect(clearDefault).toHaveBeenCalledWith("p1");
    expect(setDefault).toHaveBeenCalledWith("p1", "s1");
  });
});
