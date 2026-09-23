# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tools for orienting the caller: current user, their workspaces and workspace members.

Note: each tool function's docstring is sent to MCP clients as the tool description,
so edit those docstrings as user-facing text.
"""

# Module imports
from plane.mcp.auth import get_caller
from plane.mcp.client import api
from plane.mcp.schemas import WorkspaceSlug
from plane.mcp.services import db_call
from plane.mcp.services.workspaces import list_workspaces_for_user


async def get_current_user() -> dict:
    """Get the profile of the user who owns the API token (id, name, email, display name)."""
    return await api().get("users/me/")


async def list_workspaces() -> dict:
    """List the workspaces the current user belongs to, with their slug and the user's role."""
    caller = get_caller()
    workspaces = await db_call(list_workspaces_for_user)(caller.user_id, caller.token)
    return {"workspaces": workspaces}


async def list_workspace_members(workspace_slug: WorkspaceSlug) -> dict:
    """List the members of a workspace (user id, name, email and role). Guests cannot use this."""
    return await api().get(f"workspaces/{workspace_slug}/members/")


def register(tool) -> None:
    """Register this module's tools (all read-only)."""
    tool(read_only=True, title="Get current user")(get_current_user)
    tool(read_only=True, title="List workspaces")(list_workspaces)
    tool(read_only=True, title="List workspace members")(list_workspace_members)
