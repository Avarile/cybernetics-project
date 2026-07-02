import { describe, expect, it, vi } from "vitest";
import type { RequestContextService } from "../../infra/context/request-context";
import { ViewService } from "./view.service";
import type { ViewRepository } from "./view.repository";
import { defaultDisplayFilters, defaultDisplayProperties, type IssueView } from "./view.schema";

function viewRow(over: Partial<IssueView> = {}): IssueView {
  return {
    id: "v1",
    workspaceId: "w1",
    projectId: "p1",
    name: "My View",
    description: "",
    query: {},
    filters: {},
    displayFilters: defaultDisplayFilters(),
    displayProperties: defaultDisplayProperties(),
    richFilters: {},
    access: 1,
    sortOrder: 65535,
    logoProps: {},
    ownedBy: "u1",
    isLocked: false,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "u1",
    updatedBy: null,
    deletedAt: null,
    ...over,
  } as IssueView;
}

const ctx = { userId: "u1" } as unknown as RequestContextService;

function svc(repo: Partial<ViewRepository>, context: RequestContextService = ctx) {
  return new ViewService(repo as ViewRepository, context);
}

describe("ViewService.createProject", () => {
  it("computes sort_order = maxSortOrder + 10000 and stamps owned_by from context", async () => {
    const create = vi.fn().mockResolvedValue(viewRow({ sortOrder: 75535 }));
    const s = svc({ maxSortOrderProject: vi.fn().mockResolvedValue(65535), create });
    const result = await s.createProject("p1", { name: "My View" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", ownedBy: "u1", sortOrder: 75535, query: {} }),
    );
    expect(result.owned_by).toBe("u1");
    expect(result.project).toBe("p1");
  });

  it("defaults sort_order to 65535 when the project has no views", async () => {
    const create = vi.fn().mockResolvedValue(viewRow());
    const s = svc({ maxSortOrderProject: vi.fn().mockResolvedValue(null), create });
    await s.createProject("p1", { name: "First" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 65535 }));
  });

  it("derives query from filters and applies default display json", async () => {
    const create = vi.fn().mockResolvedValue(viewRow());
    const s = svc({ maxSortOrderProject: vi.fn().mockResolvedValue(null), create });
    await s.createProject("p1", { name: "Filtered", filters: { priority: ["high"] } });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { priority: ["high"] },
        query: { priority: ["high"] },
        displayFilters: defaultDisplayFilters(),
        displayProperties: defaultDisplayProperties(),
      }),
    );
  });
});

describe("ViewService.createWorkspace", () => {
  it("resolves the workspace from the slug and creates a project-null view", async () => {
    const create = vi.fn().mockResolvedValue(viewRow({ projectId: null }));
    const s = svc({
      resolveWorkspaceIdBySlug: vi.fn().mockResolvedValue("w1"),
      maxSortOrderWorkspace: vi.fn().mockResolvedValue(null),
      create,
    });
    const result = await s.createWorkspace("acme", { name: "Global" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w1", projectId: null }));
    expect(result.project).toBeNull();
  });

  it("rejects when the slug does not resolve to a workspace", async () => {
    const s = svc({ resolveWorkspaceIdBySlug: vi.fn().mockResolvedValue(null) });
    await expect(s.createWorkspace("nope", { name: "X" })).rejects.toMatchObject({
      response: { message: "The required object does not exist.", statusCode: 400 },
    });
  });
});

describe("ViewService.updateProject", () => {
  it("refuses to update a locked view", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(viewRow({ isLocked: true })) });
    await expect(s.updateProject("p1", "v1", { name: "New" })).rejects.toMatchObject({
      response: { error: "view is locked" },
    });
  });

  it("refuses to update a view the requester does not own", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(viewRow({ ownedBy: "someone-else" })) });
    await expect(s.updateProject("p1", "v1", { name: "New" })).rejects.toMatchObject({
      response: { error: "Only the owner of the view can update the view" },
    });
  });

  it("recomputes query from the effective filters when the owner updates", async () => {
    const update = vi.fn().mockResolvedValue(viewRow({ name: "New", filters: { state: ["s1"] } }));
    const s = svc({ findInProject: vi.fn().mockResolvedValue(viewRow()), update });
    await s.updateProject("p1", "v1", { name: "New", filters: { state: ["s1"] } });
    expect(update).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({ name: "New", filters: { state: ["s1"] }, query: { state: ["s1"] } }),
    );
  });

  it("throws when the view does not exist", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(null) });
    await expect(s.updateProject("p1", "v1", { name: "New" })).rejects.toMatchObject({
      response: { message: "The required object does not exist.", statusCode: 400 },
    });
  });
});

describe("ViewService.destroyProject", () => {
  it("soft-deletes an existing view", async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const s = svc({ findInProject: vi.fn().mockResolvedValue(viewRow()), softDelete });
    await s.destroyProject("p1", "v1");
    expect(softDelete).toHaveBeenCalledWith("v1");
  });

  it("throws when the view does not exist", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(null) });
    await expect(s.destroyProject("p1", "v1")).rejects.toMatchObject({
      response: { message: "The required object does not exist.", statusCode: 400 },
    });
  });
});

describe("ViewService.listProject", () => {
  it("serializes rows with snake_case wire keys", async () => {
    const s = svc({ listByProject: vi.fn().mockResolvedValue([viewRow({ id: "a" }), viewRow({ id: "b" })]) });
    const result = await s.listProject("p1");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "a", workspace: "w1", owned_by: "u1", sort_order: 65535, is_favorite: false });
  });
});
