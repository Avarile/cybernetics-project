import { describe, it, expect, vi } from "vitest";
import { PageService } from "./page.service";
import type { PageRepository } from "./page.repository";
import type { PageAnnotations } from "./page.serializer";
import { PAGE_ACCESS, type Page } from "./page.schema";
import { ROLE } from "../../infra/rbac/roles";

function pageRow(over: Partial<Page> = {}): Page {
  return {
    id: "pg1",
    workspaceId: "w1",
    name: "Roadmap",
    descriptionJson: {},
    descriptionBinary: null,
    descriptionHtml: "<p>hello</p>",
    descriptionStripped: "hello",
    ownedBy: "u1",
    access: PAGE_ACCESS.PUBLIC,
    color: "",
    parentId: null,
    archivedAt: null,
    isLocked: false,
    viewProps: { full_width: false },
    logoProps: {},
    isGlobal: false,
    movedToPage: null,
    movedToProject: null,
    sortOrder: 65535,
    externalSource: null,
    externalId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "u1",
    updatedBy: null,
    deletedAt: null,
    ...over,
  } as Page;
}

const ann: PageAnnotations = { is_favorite: false, label_ids: ["l1"], project_ids: ["p1"] };

function annMap(id = "pg1"): Map<string, PageAnnotations> {
  return new Map([[id, ann]]);
}

function svc(repo: Partial<PageRepository>) {
  return new PageService(repo as PageRepository);
}

describe("PageService.create", () => {
  it("creates via the repo (owner passed through) and returns detail with description_html", async () => {
    const createPage = vi.fn().mockResolvedValue(pageRow());
    const annotate = vi.fn().mockResolvedValue(annMap());
    const s = svc({ createPage, annotate });
    const result = await s.create("p1", "u1", { name: "Roadmap", labels: ["l1"] });
    expect(createPage).toHaveBeenCalledWith("p1", expect.objectContaining({ ownedById: "u1", name: "Roadmap", labels: ["l1"] }));
    expect(result).toMatchObject({ id: "pg1", owned_by: "u1", label_ids: ["l1"], project_ids: ["p1"], description_html: "<p>hello</p>" });
  });

  it("maps a unique violation to a friendly error", async () => {
    const createPage = vi.fn().mockRejectedValue({ code: "23505" });
    const s = svc({ createPage });
    await expect(s.create("p1", "u1", { name: "dup" })).rejects.toMatchObject({
      response: { error: "The page already exists" },
    });
  });
});

describe("PageService.list", () => {
  it("returns visible pages serialized with annotations (no description_html)", async () => {
    const rows = [pageRow({ id: "a" }), pageRow({ id: "b" })];
    const s = svc({
      listVisible: vi.fn().mockResolvedValue(rows),
      annotate: vi.fn().mockResolvedValue(new Map([["a", ann], ["b", ann]])),
    });
    const result = await s.list("p1", "u1");
    expect(result).toHaveLength(2);
    expect(result[0]).not.toHaveProperty("description_html");
    expect(result[0]).toMatchObject({ id: "a", label_ids: ["l1"] });
  });
});

describe("PageService.retrieve", () => {
  it("404s an invisible/unknown page", async () => {
    const s = svc({ findVisible: vi.fn().mockResolvedValue(null) });
    await expect(s.retrieve("p1", "x", "u1")).rejects.toMatchObject({ response: { error: "Page not found" } });
  });

  it("returns detail + empty issue_ids (PageLog deferred)", async () => {
    const s = svc({
      findVisible: vi.fn().mockResolvedValue(pageRow()),
      annotate: vi.fn().mockResolvedValue(annMap()),
    });
    const result = await s.retrieve("p1", "pg1", "u1");
    expect(result).toMatchObject({ id: "pg1", description_html: "<p>hello</p>", issue_ids: [] });
  });
});

describe("PageService.update", () => {
  it("returns OWNED_BY_ERROR (400) when the page is not found", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(null) });
    await expect(s.update("p1", "pg1", "u1", { name: "x" })).rejects.toMatchObject({
      response: { error: "Access cannot be updated since this page is owned by someone else" },
    });
  });

  it("forbids a non-owner acting on a private page", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(pageRow({ ownedBy: "owner", access: PAGE_ACCESS.PRIVATE })) });
    await expect(s.update("p1", "pg1", "intruder", { name: "x" })).rejects.toMatchObject({
      response: { error: "You don't have the required permissions." },
    });
  });

  it("rejects updates to a locked page", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(pageRow({ isLocked: true })) });
    await expect(s.update("p1", "pg1", "u1", { name: "x" })).rejects.toMatchObject({
      response: { error: "Page is locked" },
    });
  });

  it("blocks a non-owner from changing access", async () => {
    // public page so assertActionAccess passes; changing access as non-owner is rejected
    const s = svc({ findInProject: vi.fn().mockResolvedValue(pageRow({ ownedBy: "owner", access: PAGE_ACCESS.PUBLIC })) });
    await expect(s.update("p1", "pg1", "member", { access: PAGE_ACCESS.PRIVATE })).rejects.toMatchObject({
      response: { error: "Access cannot be updated since this page is owned by someone else" },
    });
  });

  it("applies patch + recomputes description_stripped from html", async () => {
    const updatePage = vi.fn().mockResolvedValue(pageRow({ name: "New", descriptionHtml: "<p>new</p>" }));
    const s = svc({
      findInProject: vi.fn().mockResolvedValue(pageRow()),
      updatePage,
      annotate: vi.fn().mockResolvedValue(annMap()),
    });
    await s.update("p1", "pg1", "u1", { name: "New", description_html: "<p>new</p>" });
    const patch = updatePage.mock.calls[0][1];
    expect(patch.name).toBe("New");
    expect(patch.descriptionHtml).toBe("<p>new</p>");
    expect(patch.descriptionStripped).toBe("new");
  });

  it("replaces the label set when labels are provided", async () => {
    const setLabels = vi.fn().mockResolvedValue(undefined);
    const s = svc({
      findInProject: vi.fn().mockResolvedValue(pageRow()),
      setLabels,
      updatePage: vi.fn().mockResolvedValue(pageRow()),
      annotate: vi.fn().mockResolvedValue(annMap()),
    });
    await s.update("p1", "pg1", "u1", { labels: ["l2", "l3"] });
    expect(setLabels).toHaveBeenCalledWith("pg1", "w1", ["l2", "l3"]);
  });
});

describe("PageService.destroy", () => {
  it("refuses to delete a page that is not archived", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(pageRow({ archivedAt: null })) });
    await expect(s.destroy("p1", "pg1", "u1")).rejects.toMatchObject({
      response: { error: "The page should be archived before deleting" },
    });
  });

  it("forbids a non-owner non-admin from deleting", async () => {
    const s = svc({
      findInProject: vi.fn().mockResolvedValue(pageRow({ ownedBy: "owner", archivedAt: "2026-01-01" })),
      projectMemberRole: vi.fn().mockResolvedValue(ROLE.MEMBER),
    });
    await expect(s.destroy("p1", "pg1", "member")).rejects.toMatchObject({
      response: { error: "Only admin or owner can delete the page" },
    });
  });

  it("soft-deletes an archived page for its owner", async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const s = svc({ findInProject: vi.fn().mockResolvedValue(pageRow({ archivedAt: "2026-01-01" })), softDelete });
    await s.destroy("p1", "pg1", "u1");
    expect(softDelete).toHaveBeenCalledWith("pg1");
  });

  it("lets a project admin delete an archived page they do not own", async () => {
    const softDelete = vi.fn().mockResolvedValue(undefined);
    const s = svc({
      findInProject: vi.fn().mockResolvedValue(pageRow({ ownedBy: "owner", archivedAt: "2026-01-01" })),
      projectMemberRole: vi.fn().mockResolvedValue(ROLE.ADMIN),
      softDelete,
    });
    await s.destroy("p1", "pg1", "admin");
    expect(softDelete).toHaveBeenCalledWith("pg1");
  });
});

describe("PageService.archive/unarchive", () => {
  it("archives with a date-only archived_at for the owner", async () => {
    const updatePage = vi.fn().mockResolvedValue(pageRow());
    const s = svc({ findInProject: vi.fn().mockResolvedValue(pageRow()), updatePage });
    const result = await s.archive("p1", "pg1", "u1");
    expect(result.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(updatePage).toHaveBeenCalledWith("pg1", expect.objectContaining({ archivedAt: expect.any(String) }));
  });

  it("forbids a non-owner non-admin from archiving", async () => {
    const s = svc({
      findInProject: vi.fn().mockResolvedValue(pageRow({ ownedBy: "owner" })),
      projectMemberRole: vi.fn().mockResolvedValue(ROLE.MEMBER),
    });
    await expect(s.archive("p1", "pg1", "member")).rejects.toMatchObject({
      response: { error: "Only the owner or admin can archive the page" },
    });
  });

  it("clears archived_at on unarchive", async () => {
    const updatePage = vi.fn().mockResolvedValue(pageRow());
    const s = svc({ findInProject: vi.fn().mockResolvedValue(pageRow({ archivedAt: "2026-01-01" })), updatePage });
    await s.unarchive("p1", "pg1", "u1");
    expect(updatePage).toHaveBeenCalledWith("pg1", { archivedAt: null });
  });
});

describe("PageService.lock/unlock/access", () => {
  it("locks a page", async () => {
    const updatePage = vi.fn().mockResolvedValue(pageRow());
    const s = svc({ findInProject: vi.fn().mockResolvedValue(pageRow()), updatePage });
    await s.lock("p1", "pg1", "u1");
    expect(updatePage).toHaveBeenCalledWith("pg1", { isLocked: true });
  });

  it("unlocks a page", async () => {
    const updatePage = vi.fn().mockResolvedValue(pageRow());
    const s = svc({ findInProject: vi.fn().mockResolvedValue(pageRow({ isLocked: true })), updatePage });
    await s.unlock("p1", "pg1", "u1");
    expect(updatePage).toHaveBeenCalledWith("pg1", { isLocked: false });
  });

  it("changes access for the owner", async () => {
    const updatePage = vi.fn().mockResolvedValue(pageRow());
    const s = svc({ findInProject: vi.fn().mockResolvedValue(pageRow()), updatePage });
    await s.access("p1", "pg1", "u1", { access: PAGE_ACCESS.PRIVATE });
    expect(updatePage).toHaveBeenCalledWith("pg1", { access: PAGE_ACCESS.PRIVATE });
  });

  it("blocks a non-owner from changing access", async () => {
    const s = svc({ findInProject: vi.fn().mockResolvedValue(pageRow({ ownedBy: "owner", access: PAGE_ACCESS.PUBLIC })) });
    await expect(s.access("p1", "pg1", "member", { access: PAGE_ACCESS.PRIVATE })).rejects.toMatchObject({
      response: { error: "Access cannot be updated since this page is owned by someone else" },
    });
  });
});
