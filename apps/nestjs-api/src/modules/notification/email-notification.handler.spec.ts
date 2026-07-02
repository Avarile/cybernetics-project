import { describe, it, expect, vi } from "vitest";
import type { MailerService, OutgoingEmail } from "../../infra/mailer/mailer.service";
import { StackEmailNotificationHandler } from "./email-notification.handler";
import type { NotificationRepository } from "./notification.repository";
import type { EmailNotificationLog } from "./notification.schema";

function log(id: string, receiverId: string, activity: Record<string, unknown>): EmailNotificationLog {
  return {
    id,
    receiverId,
    entityName: "issue",
    entity: "issue",
    data: { issue: { identifier: "WEB", sequence_id: 7 }, issue_activity: activity },
  } as unknown as EmailNotificationLog;
}

describe("StackEmailNotificationHandler", () => {
  it("batches unprocessed logs per receiver into one digest and marks them processed", async () => {
    const sent: OutgoingEmail[] = [];
    const marked: string[] = [];
    const logs = [
      log("l1", "r1", { verb: "updated", field: "state", old_value: "Todo", new_value: "Done" }),
      log("l2", "r1", { verb: "updated", field: "priority", old_value: "low", new_value: "high" }),
    ];
    const repo = {
      listUnprocessedEmailLogs: vi.fn().mockResolvedValue(logs),
      getUserEmail: vi.fn().mockResolvedValue("r1@x.com"),
      markEmailLogsProcessed: vi.fn().mockImplementation(async (ids: string[]) => void marked.push(...ids)),
    } as unknown as NotificationRepository;
    const mailer = { send: vi.fn().mockImplementation(async (m: OutgoingEmail) => void sent.push(m)) } as unknown as MailerService;

    await new StackEmailNotificationHandler(repo, mailer).run();

    expect(sent).toHaveLength(1); // one digest for r1
    expect(sent[0].to).toBe("r1@x.com");
    expect(sent[0].subject).toMatch(/2 updates/);
    expect(sent[0].html).toContain("WEB-7");
    expect(marked.sort()).toEqual(["l1", "l2"]);
  });

  it("no-ops when there are no unprocessed logs", async () => {
    const repo = { listUnprocessedEmailLogs: vi.fn().mockResolvedValue([]) } as unknown as NotificationRepository;
    const mailer = { send: vi.fn() } as unknown as MailerService;
    await new StackEmailNotificationHandler(repo, mailer).run();
    expect(mailer.send).not.toHaveBeenCalled();
  });
});
