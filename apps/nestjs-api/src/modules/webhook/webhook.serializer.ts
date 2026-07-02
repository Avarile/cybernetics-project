import type { Webhook } from "./webhook.schema";

export interface WebhookDTO {
  id: string;
  url: string;
  is_active: boolean;
  secret_key: string;
  project: boolean;
  issue: boolean;
  module: boolean;
  cycle: boolean;
  issue_comment: boolean;
  workspace: string;
  created_at: Date;
  updated_at: Date;
}

export function serializeWebhook(w: Webhook): WebhookDTO {
  return {
    id: w.id,
    url: w.url,
    is_active: w.isActive,
    secret_key: w.secretKey,
    project: w.project,
    issue: w.issue,
    module: w.module,
    cycle: w.cycle,
    issue_comment: w.issueComment,
    workspace: w.workspaceId,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
  };
}
