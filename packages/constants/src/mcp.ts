/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * The MCP (Model Context Protocol) server exposed by the API.
 *
 * The catalogue below mirrors the tools registered in apps/api/plane/mcp/tools/*,
 * which is the source of truth: `name`, `mode` and the description come from the
 * tool's annotations and docstring. Keep both sides in step when tools change.
 */

/** Path the MCP endpoint is mounted on, relative to the API host (MCP_PATH on the API). */
export const MCP_ENDPOINT_PATH = "/api/mcp";

/** Protocol revisions the server speaks (it serves 2025-era clients from the same endpoint). */
export const MCP_PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18"] as const;

export type TMCPToolMode = "read" | "write" | "destructive";

export type TMCPToolGroup =
  | "context"
  | "projects"
  | "work_items"
  | "work_item_extras"
  | "cycles"
  | "modules"
  | "intake";

export type TMCPTool = {
  name: string;
  group: TMCPToolGroup;
  mode: TMCPToolMode;
  /** One-line summary, taken from the tool's docstring. */
  description: string;
};

/** Order the groups are rendered in, from "find your way around" to the narrower areas. */
export const MCP_TOOL_GROUPS: TMCPToolGroup[] = [
  "context",
  "projects",
  "work_items",
  "work_item_extras",
  "cycles",
  "modules",
  "intake",
];

export const MCP_TOOL_GROUP_LABELS: Record<TMCPToolGroup, string> = {
  context: "account_settings.mcp.tools.groups.context",
  projects: "account_settings.mcp.tools.groups.projects",
  work_items: "account_settings.mcp.tools.groups.work_items",
  work_item_extras: "account_settings.mcp.tools.groups.work_item_extras",
  cycles: "account_settings.mcp.tools.groups.cycles",
  modules: "account_settings.mcp.tools.groups.modules",
  intake: "account_settings.mcp.tools.groups.intake",
};

export const MCP_TOOLS: TMCPTool[] = [
  {
    name: "get_current_user",
    group: "context",
    mode: "read",
    description: "Get the profile of the user who owns the API token (id, name, email, display name).",
  },
  {
    name: "list_workspaces",
    group: "context",
    mode: "read",
    description: "List the workspaces the current user belongs to, with their slug and the user's role.",
  },
  {
    name: "list_workspace_members",
    group: "context",
    mode: "read",
    description: "List the members of a workspace (user id, name, email and role). Guests cannot use this.",
  },
  {
    name: "list_projects",
    group: "projects",
    mode: "read",
    description: "List the projects in a workspace that the current user can access (id, identifier, name).",
  },
  {
    name: "get_project",
    group: "projects",
    mode: "read",
    description: "Get the full details of a project.",
  },
  {
    name: "list_states",
    group: "projects",
    mode: "read",
    description: "List a project's workflow states (id, name, group). Use the id as state_id for work items.",
  },
  {
    name: "list_labels",
    group: "projects",
    mode: "read",
    description: "List a project's labels (id, name, color, parent). Use the ids as label_ids for work items.",
  },
  {
    name: "list_project_members",
    group: "projects",
    mode: "read",
    description: "List a project's members. Use their user ids as assignee_ids for work items.",
  },
  {
    name: "create_label",
    group: "projects",
    mode: "write",
    description: "Create a label in a project.",
  },
  {
    name: "list_work_items",
    group: "work_items",
    mode: "read",
    description: "List work items the current user can see, with optional filters. Filters combine with AND; values inside one filter combine with OR. For example assignees=['me'] and state_groups=['unstarted', 'started'] lists the user's open work. Returns a page of results, the total count and next_offset.",
  },
  {
    name: "search_work_items",
    group: "work_items",
    mode: "read",
    description: "Quick search for work items by name or key, across the workspace or within one project.",
  },
  {
    name: "get_work_item",
    group: "work_items",
    mode: "read",
    description: "Get a work item with its state, assignees and labels expanded. Pass either its key (e.g. 'WEB-123') or both project_id and work_item_id.",
  },
  {
    name: "create_work_item",
    group: "work_items",
    mode: "write",
    description: "Create a work item in a project. Unset fields use the project's defaults.",
  },
  {
    name: "update_work_item",
    group: "work_items",
    mode: "write",
    description: "Update a work item. Only the fields you pass change. assignee_ids and label_ids REPLACE the whole set, so include the existing ids you want to keep (see get_work_item).",
  },
  {
    name: "delete_work_item",
    group: "work_items",
    mode: "destructive",
    description: "Delete a work item. Only its creator or a project admin can do this.",
  },
  {
    name: "list_work_item_comments",
    group: "work_item_extras",
    mode: "read",
    description: "List the comments on a work item.",
  },
  {
    name: "add_work_item_comment",
    group: "work_item_extras",
    mode: "write",
    description: "Add a comment to a work item.",
  },
  {
    name: "list_work_item_activities",
    group: "work_item_extras",
    mode: "read",
    description: "List the change history of a work item (who changed which field, old and new values).",
  },
  {
    name: "add_work_item_link",
    group: "work_item_extras",
    mode: "write",
    description: "Attach an external link (pull request, document, ...) to a work item.",
  },
  {
    name: "list_work_item_relations",
    group: "work_item_extras",
    mode: "read",
    description: "List a work item's relations (blocking, blocked_by, duplicate, relates_to, ...).",
  },
  {
    name: "add_work_item_relation",
    group: "work_item_extras",
    mode: "write",
    description: "Relate a work item to other work items, e.g. relation_type='blocked_by'.",
  },
  {
    name: "list_cycles",
    group: "cycles",
    mode: "read",
    description: "List a project's cycles (sprints). cycle_view='current' returns the active cycle.",
  },
  {
    name: "get_cycle",
    group: "cycles",
    mode: "read",
    description: "Get a cycle with its progress counters.",
  },
  {
    name: "create_cycle",
    group: "cycles",
    mode: "write",
    description: "Create a cycle. Pass both start_date and end_date, or neither (a draft cycle).",
  },
  {
    name: "list_cycle_work_items",
    group: "cycles",
    mode: "read",
    description: "List the work items in a cycle.",
  },
  {
    name: "add_work_items_to_cycle",
    group: "cycles",
    mode: "write",
    description: "Add work items to a cycle. A work item belongs to one cycle, so this moves it from any other cycle.",
  },
  {
    name: "remove_work_item_from_cycle",
    group: "cycles",
    mode: "destructive",
    description: "Remove a work item from a cycle (the work item itself is kept).",
  },
  {
    name: "list_modules",
    group: "modules",
    mode: "read",
    description: "List a project's modules (feature groupings) with their status and progress.",
  },
  {
    name: "create_module",
    group: "modules",
    mode: "write",
    description: "Create a module in a project.",
  },
  {
    name: "list_module_work_items",
    group: "modules",
    mode: "read",
    description: "List the work items in a module.",
  },
  {
    name: "add_work_items_to_module",
    group: "modules",
    mode: "write",
    description: "Add work items to a module. A work item can belong to several modules.",
  },
  {
    name: "remove_work_item_from_module",
    group: "modules",
    mode: "destructive",
    description: "Remove a work item from a module (the work item itself is kept).",
  },
  {
    name: "create_intake_work_item",
    group: "intake",
    mode: "write",
    description: "Submit a work item to a project's intake queue for triage (for example a bug report). The project must have intake enabled.",
  },
];

