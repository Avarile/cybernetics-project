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
  | "project_setup"
  | "members"
  | "work_items"
  | "work_item_extras"
  | "cycles"
  | "modules"
  | "intake"
  | "estimates"
  | "stickies"
  | "agents";

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
  "project_setup",
  "members",
  "work_items",
  "work_item_extras",
  "cycles",
  "modules",
  "intake",
  "estimates",
  "stickies",
  "agents",
];

export const MCP_TOOL_GROUP_LABELS: Record<TMCPToolGroup, string> = {
  context: "account_settings.mcp.tools.groups.context",
  projects: "account_settings.mcp.tools.groups.projects",
  project_setup: "account_settings.mcp.tools.groups.project_setup",
  members: "account_settings.mcp.tools.groups.members",
  work_items: "account_settings.mcp.tools.groups.work_items",
  work_item_extras: "account_settings.mcp.tools.groups.work_item_extras",
  cycles: "account_settings.mcp.tools.groups.cycles",
  modules: "account_settings.mcp.tools.groups.modules",
  intake: "account_settings.mcp.tools.groups.intake",
  estimates: "account_settings.mcp.tools.groups.estimates",
  stickies: "account_settings.mcp.tools.groups.stickies",
  agents: "account_settings.mcp.tools.groups.agents",
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
    name: "get_project_summary",
    group: "projects",
    mode: "read",
    description: "Get a project's counts (members, states, labels, cycles, modules, work items, intake items).",
  },
  {
    name: "create_project",
    group: "projects",
    mode: "write",
    description:
      "Create a project. You become its admin and it gets the default workflow states (Backlog, Todo, In Progress, Done, Cancelled). Cycles and modules are enabled unless turned off; enable intake to accept triage submissions. Workspace guests cannot create projects.",
  },
  {
    name: "update_project",
    group: "projects",
    mode: "write",
    description: "Update a project's settings. Only the fields you pass change. Archived projects cannot be edited.",
  },
  {
    name: "delete_project",
    group: "projects",
    mode: "destructive",
    description:
      "Permanently delete a project and everything in it (work items, cycles, modules, ...). This cannot be undone. Pass the project's identifier as confirm_identifier; the call is refused if it does not match. Only project admins can do this.",
  },
  {
    name: "archive_project",
    group: "projects",
    mode: "write",
    description: "Archive a project: it is hidden from active project lists and becomes read-only.",
  },
  {
    name: "unarchive_project",
    group: "projects",
    mode: "write",
    description: "Restore an archived project.",
  },
  {
    name: "list_states",
    group: "project_setup",
    mode: "read",
    description: "List a project's workflow states (id, name, group). Use the id as state_id for work items.",
  },
  {
    name: "create_state",
    group: "project_setup",
    mode: "write",
    description: "Add a workflow state to a project. The group decides how it counts towards progress.",
  },
  {
    name: "update_state",
    group: "project_setup",
    mode: "write",
    description: "Update a workflow state. Only the fields you pass change.",
  },
  {
    name: "delete_state",
    group: "project_setup",
    mode: "destructive",
    description: "Delete a workflow state. The default state and states that still have work items cannot be deleted.",
  },
  {
    name: "list_labels",
    group: "project_setup",
    mode: "read",
    description: "List a project's labels (id, name, color, parent). Use the ids as label_ids for work items.",
  },
  {
    name: "create_label",
    group: "project_setup",
    mode: "write",
    description: "Create a label in a project.",
  },
  {
    name: "update_label",
    group: "project_setup",
    mode: "write",
    description: "Update a label. Only the fields you pass change.",
  },
  {
    name: "delete_label",
    group: "project_setup",
    mode: "destructive",
    description: "Delete a label. It is removed from every work item that has it.",
  },
  {
    name: "list_project_members",
    group: "members",
    mode: "read",
    description: "List a project's members. Use their user ids as assignee_ids for work items.",
  },
  {
    name: "add_project_member",
    group: "members",
    mode: "write",
    description: "Add a workspace member to a project. Only project admins can do this.",
  },
  {
    name: "update_project_member",
    group: "members",
    mode: "write",
    description: "Change a project member's role. Only project admins can do this.",
  },
  {
    name: "remove_project_member",
    group: "members",
    mode: "destructive",
    description: "Remove a member from a project (they stay in the workspace). Only project admins can do this.",
  },
  {
    name: "list_workspace_invitations",
    group: "members",
    mode: "read",
    description: "List pending workspace invitations (email, role, whether accepted). Workspace admins only.",
  },
  {
    name: "invite_workspace_member",
    group: "members",
    mode: "write",
    description:
      "Invite someone to the workspace by email. This records the invitation; it does not send an email itself. Workspace admins only.",
  },
  {
    name: "cancel_workspace_invitation",
    group: "members",
    mode: "destructive",
    description: "Cancel a workspace invitation. Workspace admins only.",
  },
  {
    name: "list_work_items",
    group: "work_items",
    mode: "read",
    description:
      "List work items the current user can see, with optional filters. Filters combine with AND; values inside one filter combine with OR. For example assignees=['me'] and state_groups=['unstarted', 'started'] lists the user's open work, and adding due_before=<yesterday> finds what is overdue. Returns a page of results, the total count and next_offset.",
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
    description:
      "Get a work item with its state, assignees and labels expanded. Pass either its key (e.g. 'WEB-123') or both project_id and work_item_id.",
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
    description:
      "Update a work item. Only the fields you pass change. assignee_ids and label_ids REPLACE the whole set, so include the existing ids you want to keep (see get_work_item).",
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
    name: "update_work_item_comment",
    group: "work_item_extras",
    mode: "write",
    description: "Replace a comment's text.",
  },
  {
    name: "delete_work_item_comment",
    group: "work_item_extras",
    mode: "destructive",
    description: "Delete a comment from a work item.",
  },
  {
    name: "list_work_item_links",
    group: "work_item_extras",
    mode: "read",
    description: "List the external links attached to a work item.",
  },
  {
    name: "update_work_item_link",
    group: "work_item_extras",
    mode: "write",
    description: "Change a link's URL or title.",
  },
  {
    name: "delete_work_item_link",
    group: "work_item_extras",
    mode: "destructive",
    description: "Remove a link from a work item.",
  },
  {
    name: "list_work_item_attachments",
    group: "work_item_extras",
    mode: "read",
    description: "List a work item's file attachments (name, size, type, uploader). Uploading is not supported here.",
  },
  {
    name: "delete_work_item_attachment",
    group: "work_item_extras",
    mode: "destructive",
    description: "Delete a file attachment from a work item.",
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
    name: "update_cycle",
    group: "cycles",
    mode: "write",
    description: "Update a cycle. Only the fields you pass change. Completed cycles cannot be edited.",
  },
  {
    name: "delete_cycle",
    group: "cycles",
    mode: "destructive",
    description: "Delete a cycle. Its work items are kept, they are only removed from the cycle.",
  },
  {
    name: "transfer_cycle_work_items",
    group: "cycles",
    mode: "write",
    description:
      "Move a finished cycle's unfinished work items into another cycle (sprint rollover). Completed and cancelled work items stay. The source cycle must have ended.",
  },
  {
    name: "archive_cycle",
    group: "cycles",
    mode: "write",
    description: "Archive a cycle. Only cycles whose end date has passed can be archived.",
  },
  {
    name: "unarchive_cycle",
    group: "cycles",
    mode: "write",
    description: "Restore an archived cycle.",
  },
  {
    name: "list_archived_cycles",
    group: "cycles",
    mode: "read",
    description: "List a project's archived cycles.",
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
    name: "get_module",
    group: "modules",
    mode: "read",
    description: "Get a module with its status, dates, lead, members and progress counters.",
  },
  {
    name: "update_module",
    group: "modules",
    mode: "write",
    description: "Update a module. Only the fields you pass change.",
  },
  {
    name: "delete_module",
    group: "modules",
    mode: "destructive",
    description: "Delete a module. Its work items are kept, they are only removed from the module.",
  },
  {
    name: "archive_module",
    group: "modules",
    mode: "write",
    description: "Archive a module. Only modules with status 'completed' or 'cancelled' can be archived.",
  },
  {
    name: "unarchive_module",
    group: "modules",
    mode: "write",
    description: "Restore an archived module.",
  },
  {
    name: "list_archived_modules",
    group: "modules",
    mode: "read",
    description: "List a project's archived modules.",
  },
  {
    name: "create_intake_work_item",
    group: "intake",
    mode: "write",
    description:
      "Submit a work item to a project's intake queue for triage (for example a bug report). The project must have intake enabled.",
  },
  {
    name: "list_intake_work_items",
    group: "intake",
    mode: "read",
    description: "List the items in a project's intake queue with their triage status.",
  },
  {
    name: "get_intake_work_item",
    group: "intake",
    mode: "read",
    description: "Get one intake item with its triage status and work item details.",
  },
  {
    name: "triage_intake_work_item",
    group: "intake",
    mode: "write",
    description:
      "Triage an intake item: 'accept' moves it into the project as a regular work item, 'reject' declines it, 'snooze' hides it until snoozed_till, 'duplicate' marks it as a duplicate of duplicate_of_id, 'pending' puts it back in the queue. Only project admins can triage.",
  },
  {
    name: "delete_intake_work_item",
    group: "intake",
    mode: "destructive",
    description: "Delete an intake item. Its work item is deleted too unless it was already accepted.",
  },
  {
    name: "get_estimate",
    group: "estimates",
    mode: "read",
    description: "Get the project's estimate system (id, name, type). Fails with 404 if it has none.",
  },
  {
    name: "create_estimate",
    group: "estimates",
    mode: "write",
    description:
      "Create the project's estimate system, then add its values with create_estimate_points and activate it with update_project(estimate_id=...). A project can only have one estimate.",
  },
  {
    name: "update_estimate",
    group: "estimates",
    mode: "write",
    description: "Rename the project's estimate or change its description.",
  },
  {
    name: "delete_estimate",
    group: "estimates",
    mode: "destructive",
    description: "Delete the project's estimate system and all of its points.",
  },
  {
    name: "list_estimate_points",
    group: "estimates",
    mode: "read",
    description: "List an estimate's points. Use their ids as estimate_point_id for work items.",
  },
  {
    name: "create_estimate_points",
    group: "estimates",
    mode: "write",
    description: "Add points to an estimate in one call, e.g. [{key: 0, value: '1'}, {key: 1, value: '2'}].",
  },
  {
    name: "update_estimate_point",
    group: "estimates",
    mode: "write",
    description: "Change an estimate point's value, position or description.",
  },
  {
    name: "delete_estimate_point",
    group: "estimates",
    mode: "destructive",
    description: "Delete an estimate point.",
  },
  {
    name: "list_stickies",
    group: "stickies",
    mode: "read",
    description: "List your stickies (personal notes) in a workspace.",
  },
  {
    name: "create_sticky",
    group: "stickies",
    mode: "write",
    description: "Create a sticky (a personal note visible only to you).",
  },
  {
    name: "update_sticky",
    group: "stickies",
    mode: "write",
    description: "Update a sticky. Only the fields you pass change.",
  },
  {
    name: "delete_sticky",
    group: "stickies",
    mode: "destructive",
    description: "Delete a sticky.",
  },
  {
    name: "list_agents",
    group: "agents",
    mode: "read",
    description:
      "List the workspace's agentic members (AI agents defined in Plane) with handle, summary and capabilities.",
  },
  {
    name: "get_agent_context",
    group: "agents",
    mode: "read",
    description: "Load an agent's definition as prompt-ready Markdown to use as operating instructions.",
  },
  {
    name: "get_agent",
    group: "agents",
    mode: "read",
    description: "Get an agent's full structured definition and status, including its bot_user_id used for assignment.",
  },
  {
    name: "list_agent_work_items",
    group: "agents",
    mode: "read",
    description: "List work items assigned to an agent (its queue).",
  },
  {
    name: "get_agent_task_brief",
    group: "agents",
    mode: "read",
    description: "Get a task brief: the agent's definition plus one of its assigned work items, as Markdown.",
  },
  {
    name: "list_agent_revisions",
    group: "agents",
    mode: "read",
    description: "List an agent's definition versions with change notes.",
  },
  {
    name: "create_agent",
    group: "agents",
    mode: "write",
    description: "Create an agentic member (workspace admins only).",
  },
  {
    name: "update_agent",
    group: "agents",
    mode: "write",
    description: "Update an agent (workspace admins only). Definition changes bump the version.",
  },
  {
    name: "archive_agent",
    group: "agents",
    mode: "write",
    description: "Archive an agent: it leaves its projects and cannot get new assignments.",
  },
  {
    name: "grant_agent_project_access",
    group: "agents",
    mode: "write",
    description: "Let an agent be assigned work items in the given projects.",
  },
  {
    name: "revoke_agent_project_access",
    group: "agents",
    mode: "destructive",
    description: "Remove an agent's access to a project (existing assignments are kept).",
  },
];
