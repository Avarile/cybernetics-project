/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAgentStatus } from "@plane/types";

/** ``User.bot_type`` of agentic members' bot users. */
export const AGENT_BOT_TYPE = "AGENT";

export const AGENT_HANDLE_REGEX = /^[a-z0-9][a-z0-9_-]{1,47}$/;
export const AGENT_SUMMARY_MAX_LENGTH = 280;
export const AGENT_MARKDOWN_MAX_LENGTH = 20000;
export const AGENT_WORKFLOW_MAX_STEPS = 50;
export const AGENT_CONTEXT_MAX_BYTES = 64 * 1024;

export const AGENT_STATUS_DETAILS: Record<TAgentStatus, { i18n_label: string; className: string }> = {
  active: { i18n_label: "agents.status.active", className: "bg-success-subtle text-success-primary" },
  paused: { i18n_label: "agents.status.paused", className: "bg-warning-subtle text-warning-primary" },
  archived: { i18n_label: "agents.status.archived", className: "bg-layer-3 text-tertiary" },
};

export const AGENT_DETAIL_TABS = [
  { key: "overview", i18n_label: "agents.tabs.overview" },
  { key: "how-it-works", i18n_label: "agents.tabs.how_it_works" },
  { key: "workflow", i18n_label: "agents.tabs.workflow" },
  { key: "tools", i18n_label: "agents.tabs.tools" },
  { key: "context", i18n_label: "agents.tabs.context" },
  { key: "projects", i18n_label: "agents.tabs.projects" },
  { key: "work-items", i18n_label: "agents.tabs.work_items" },
  { key: "settings", i18n_label: "agents.tabs.settings" },
] as const;

export type TAgentDetailTab = (typeof AGENT_DETAIL_TABS)[number]["key"];

/** Turn a display name into a handle suggestion ("QA Bot" -> "qa-bot"). */
export const agentHandleFromName = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
