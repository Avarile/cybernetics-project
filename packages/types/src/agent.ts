/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** Agentic members: AI agents defined in a workspace, assignable like members and served to LLMs as context. */

export type TAgentStatus = "active" | "paused" | "archived";

export type TAgentWorkflowStep = {
  id: string;
  title: string;
  description_md: string;
  expected_output_md: string;
  requires_approval: boolean;
};

export type TAgentTool = {
  name: string;
  description: string;
  usage_md: string;
};

export type TAgentUserLite = {
  id: string;
  display_name: string;
  first_name: string;
  avatar_url: string | null;
  is_bot: boolean;
  bot_type: string | null;
};

export type TAgentLogoProps = {
  in_use?: "emoji" | "icon";
  emoji?: { value?: string };
  icon?: { name?: string; color?: string };
};

export interface IWorkspaceAgent {
  id: string;
  workspace: string;
  bot_user: TAgentUserLite;
  bot_user_id: string;
  name: string;
  handle: string;
  role_title: string;
  logo_props: TAgentLogoProps;
  summary: string;
  profile_md: string;
  goal_md: string;
  how_it_works_md: string;
  instructions_md: string;
  workflow: TAgentWorkflowStep[];
  capabilities: string[];
  tools: TAgentTool[];
  runtime_hints: Record<string, string | number | boolean>;
  status: TAgentStatus;
  accept_assignments: boolean;
  owner: TAgentUserLite | null;
  owner_id: string | null;
  version: number;
  definition_hash: string;
  metadata: Record<string, unknown>;
  sort_order: number;
  project_ids: string[];
  assigned_open_count: number;
  created_at: string;
  updated_at: string;
}

/** Fields an admin can write; ``change_note`` describes a definition change (stored on the revision). */
export type TAgentPayload = Partial<
  Pick<
    IWorkspaceAgent,
    | "name"
    | "handle"
    | "role_title"
    | "logo_props"
    | "summary"
    | "profile_md"
    | "goal_md"
    | "how_it_works_md"
    | "instructions_md"
    | "workflow"
    | "capabilities"
    | "tools"
    | "runtime_hints"
    | "status"
    | "accept_assignments"
    | "owner_id"
  >
> & { change_note?: string; initial_project_ids?: string[] };

export type TAgentRevision = {
  id: string;
  version: number;
  definition: Record<string, unknown>;
  definition_hash: string;
  change_note: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
};

export type TAgentContextPreview = {
  markdown: string;
  json: Record<string, unknown>;
  size_bytes: number;
  version: number;
  changed: boolean;
};

export type TAgentWorkItem = {
  id: string;
  key: string;
  name: string;
  project_id: string;
  project_identifier: string;
  state_id: string | null;
  state_name: string | null;
  state_group: string | null;
  priority: string;
  start_date: string | null;
  target_date: string | null;
  sequence_id: number;
  updated_at: string;
};
