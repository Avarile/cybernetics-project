import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DeleteApiLogsHandler,
  DeleteEmailNotificationLogsHandler,
  DeleteIssueDescriptionVersionsHandler,
  DeletePageVersionsHandler,
  DeleteWebhookLogsHandler,
  HardDeleteHandler,
} from "./maintenance.handlers";
import type { MaintenanceRepository } from "./maintenance.repository";

function repoMock() {
  return {
    deleteApiLogsOlderThan: vi.fn().mockResolvedValue(undefined),
    deleteEmailLogsSentBefore: vi.fn().mockResolvedValue(undefined),
    deleteWebhookLogsOlderThan: vi.fn().mockResolvedValue(undefined),
    pruneVersions: vi.fn().mockResolvedValue(undefined),
    hardDelete: vi.fn().mockResolvedValue(undefined),
  } as unknown as MaintenanceRepository;
}

afterEach(() => {
  delete process.env.API_ACTIVITY_LOG_RETENTION_DAYS;
  delete process.env.HARD_DELETE_AFTER_DAYS;
});

describe("maintenance handlers", () => {
  it("delete_api_logs uses the default 14-day window", async () => {
    const repo = repoMock();
    await new DeleteApiLogsHandler(repo).run();
    expect(repo.deleteApiLogsOlderThan).toHaveBeenCalledWith(14);
  });

  it("delete_api_logs honours the retention env override", async () => {
    process.env.API_ACTIVITY_LOG_RETENTION_DAYS = "30";
    const repo = repoMock();
    await new DeleteApiLogsHandler(repo).run();
    expect(repo.deleteApiLogsOlderThan).toHaveBeenCalledWith(30);
  });

  it("email logs default to 7 days (by sent_at)", async () => {
    const repo = repoMock();
    await new DeleteEmailNotificationLogsHandler(repo).run();
    expect(repo.deleteEmailLogsSentBefore).toHaveBeenCalledWith(7);
  });

  it("webhook logs default to 14 days", async () => {
    const repo = repoMock();
    await new DeleteWebhookLogsHandler(repo).run();
    expect(repo.deleteWebhookLogsOlderThan).toHaveBeenCalledWith(14);
  });

  it("page/issue version pruning keeps the latest 20 per partition", async () => {
    const repo = repoMock();
    await new DeletePageVersionsHandler(repo).run();
    await new DeleteIssueDescriptionVersionsHandler(repo).run();
    expect(repo.pruneVersions).toHaveBeenCalledWith("page_versions", "page_id", 20);
    expect(repo.pruneVersions).toHaveBeenCalledWith("issue_description_versions", "issue_id", 20);
  });

  it("hard_delete defaults to a 60-day retention", async () => {
    const repo = repoMock();
    await new HardDeleteHandler(repo).run();
    expect(repo.hardDelete).toHaveBeenCalledWith(60);
  });
});
