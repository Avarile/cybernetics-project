import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { WebhookSendHandler } from "./webhook-send.handler";
import type { WebhookRepository } from "./webhook.repository";
import type { Webhook } from "./webhook.schema";
import { signWebhook } from "./webhook.signature";

// Loosely-typed so the axios.post overloads don't fight vitest's MockInstance generic.
let mockedPost: {
  mockResolvedValue: (v: unknown) => unknown;
  mockRejectedValueOnce: (v: unknown) => unknown;
  mockRestore: () => void;
};
beforeEach(() => {
  const spy = vi.spyOn(axios, "post");
  spy.mockResolvedValue({ status: 200, headers: {}, data: "ok" } as never);
  mockedPost = spy as unknown as typeof mockedPost;
});
afterEach(() => {
  mockedPost.mockRestore();
});

function webhookRow(over: Partial<Webhook> = {}): Webhook {
  return {
    id: "wh1",
    workspaceId: "w1",
    url: "https://example.com/hook",
    isActive: true,
    secretKey: "supersecret",
    project: false,
    issue: true,
    module: false,
    cycle: false,
    issueComment: false,
    isInternal: false,
    version: "v1",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...over,
  } as Webhook;
}

function make(webhook: Webhook | null) {
  const logs: Record<string, unknown>[] = [];
  const repo = {
    findById: vi.fn().mockResolvedValue(webhook),
    log: vi.fn().mockImplementation(async (e: Record<string, unknown>) => {
      logs.push(e);
    }),
  } as unknown as WebhookRepository;
  return { handler: new WebhookSendHandler(repo), repo, logs };
}

const kwargs = { webhook_id: "wh1", slug: "acme", event: "issue", action: "created", event_data: { id: "i1" }, activity: {} };

describe("WebhookSendHandler", () => {
  it("signs the body with HMAC-SHA256 (X-Plane-Signature) and logs a 200", async () => {
    mockedPost.mockResolvedValue({ status: 200, headers: { x: "y" }, data: "ok" });
    const { handler, logs } = make(webhookRow());
    await handler.run(kwargs);

    // Assert via the (fresh-per-make) log row rather than the shared axios spy history.
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ webhook: "wh1", eventType: "issue", requestMethod: "POST", responseStatus: "200" });
    const headers = JSON.parse(logs[0].requestHeaders as string) as Record<string, string>;
    expect(headers["X-Plane-Event"]).toBe("issue");
    expect(headers["X-Plane-Signature"]).toBe(signWebhook("supersecret", logs[0].requestBody as string));
  });

  it("blocks delivery to internal URLs (no POST, no log)", async () => {
    const { handler, logs } = make(webhookRow({ url: "http://127.0.0.1/hook" }));
    await handler.run(kwargs);
    expect(logs).toHaveLength(0);
  });

  it("logs an error row when delivery throws", async () => {
    mockedPost.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { handler, logs } = make(webhookRow());
    await handler.run(kwargs);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ responseStatus: "error" });
  });

  it("skips inactive/missing webhooks (no log)", async () => {
    const { handler, logs } = make(null);
    await handler.run(kwargs);
    expect(logs).toHaveLength(0);
  });
});
