import { describe, it, expect, vi, afterEach } from "vitest";
import axios from "axios";
import { CrawlWorkItemLinkTitleHandler, RecentVisitedHandler, extractTitle } from "./tracking.handlers";
import type { TrackingRepository } from "./tracking.repository";
import type { IssueLink } from "./tracking.schema";

afterEach(() => vi.restoreAllMocks());

describe("extractTitle", () => {
  it("pulls and normalises the <title>", () => {
    expect(extractTitle("<html><head><title>  Hello\n World </title></head></html>")).toBe("Hello World");
    expect(extractTitle("<html>no title</html>")).toBeNull();
  });
});

describe("RecentVisitedHandler", () => {
  it("resolves the workspace and upserts the visit", async () => {
    const repo = {
      workspaceIdBySlug: vi.fn().mockResolvedValue("w1"),
      upsertRecentVisit: vi.fn().mockResolvedValue(undefined),
    } as unknown as TrackingRepository;
    await new RecentVisitedHandler(repo).run({ entity_name: "issue", entity_identifier: "i1", user_id: "u1", project_id: "p1", slug: "acme" });
    expect(repo.upsertRecentVisit).toHaveBeenCalledWith("issue", "i1", "u1", "w1", "p1");
  });

  it("skips when required kwargs are missing", async () => {
    const repo = { workspaceIdBySlug: vi.fn(), upsertRecentVisit: vi.fn() } as unknown as TrackingRepository;
    await new RecentVisitedHandler(repo).run({ entity_name: "issue" });
    expect(repo.workspaceIdBySlug).not.toHaveBeenCalled();
  });
});

describe("CrawlWorkItemLinkTitleHandler", () => {
  it("fetches the page title and updates the link (public URL)", async () => {
    const repo = {
      findLink: vi.fn().mockResolvedValue({ id: "l1", url: "https://example.com", metadata: {} } as IssueLink),
      updateLinkTitle: vi.fn().mockResolvedValue(undefined),
    } as unknown as TrackingRepository;
    vi.spyOn(axios, "get").mockResolvedValue({ data: "<title>Example Domain</title>" });
    await new CrawlWorkItemLinkTitleHandler(repo).run({ link_id: "l1" });
    expect(repo.updateLinkTitle).toHaveBeenCalledWith("l1", "Example Domain", expect.objectContaining({ title: "Example Domain" }));
  });

  it("refuses to fetch internal URLs (SSRF guard)", async () => {
    const repo = {
      findLink: vi.fn().mockResolvedValue({ id: "l1", url: "http://169.254.169.254/latest/meta-data", metadata: {} } as IssueLink),
      updateLinkTitle: vi.fn(),
    } as unknown as TrackingRepository;
    const getSpy = vi.spyOn(axios, "get");
    await new CrawlWorkItemLinkTitleHandler(repo).run({ link_id: "l1" });
    expect(getSpy).not.toHaveBeenCalled();
    expect(repo.updateLinkTitle).not.toHaveBeenCalled();
  });
});
