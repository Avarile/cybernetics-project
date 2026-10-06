# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tools for project membership and workspace invitations.

Note: each tool function's docstring is sent to MCP clients as the tool description,
so edit those docstrings as user-facing text.
"""

# Python imports
from typing import Annotated
from uuid import UUID

# Third party imports
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

# Module imports
from plane.mcp.auth import get_caller
from plane.mcp.client import api
from plane.mcp.schemas import ROLE_VALUES, InvitationId, MemberRole, ProjectId, UserId, WorkspaceSlug
from plane.mcp.services import db_call
from plane.mcp.services.members import project_membership_id
from plane.mcp.tools.common import project_path

Email = Annotated[str, Field(min_length=3, max_length=255, pattern=r"^[^@\s]+@[^@\s]+$")]


async def membership_path(workspace_slug: str, project_id: UUID, user_id: UUID) -> str:
    """Resolve the user's membership and return its API path; raise ToolError if they are not a member."""
    caller = get_caller()
    membership_id = await db_call(project_membership_id)(caller.user_id, workspace_slug, str(project_id), str(user_id))
    if membership_id is None:
        raise ToolError("That user is not an active member of this project (see list_project_members)")
    return f"{project_path(workspace_slug, project_id)}/members/{membership_id}/"


async def list_project_members(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """List a project's members. Use their user ids as assignee_ids for work items."""
    return await api().get(f"{project_path(workspace_slug, project_id)}/members/")


async def add_project_member(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, user_id: UserId, role: MemberRole = "member"
) -> dict:
    """Add a workspace member to a project. Only project admins can do this."""
    body = {"member": str(user_id), "role": ROLE_VALUES[role]}
    return await api().post(f"{project_path(workspace_slug, project_id)}/members/", body)


async def update_project_member(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, user_id: UserId, role: MemberRole
) -> dict:
    """Change a project member's role. Only project admins can do this."""
    path = await membership_path(workspace_slug, project_id, user_id)
    return await api().patch(path, {"role": ROLE_VALUES[role]})


async def remove_project_member(workspace_slug: WorkspaceSlug, project_id: ProjectId, user_id: UserId) -> dict:
    """Remove a member from a project (they stay in the workspace). Only project admins can do this."""
    return await api().delete(await membership_path(workspace_slug, project_id, user_id))


async def list_workspace_invitations(workspace_slug: WorkspaceSlug) -> dict:
    """List pending workspace invitations (email, role, whether accepted). Workspace admins only."""
    return await api().get(f"workspaces/{workspace_slug}/invitations/")


async def invite_workspace_member(workspace_slug: WorkspaceSlug, email: Email, role: MemberRole = "member") -> dict:
    """
    Invite someone to the workspace by email. This records the invitation; it does not send an
    email itself. Workspace admins only.
    """
    return await api().post(f"workspaces/{workspace_slug}/invitations/", {"email": email, "role": ROLE_VALUES[role]})


async def cancel_workspace_invitation(workspace_slug: WorkspaceSlug, invitation_id: InvitationId) -> dict:
    """Cancel a workspace invitation. Workspace admins only."""
    return await api().delete(f"workspaces/{workspace_slug}/invitations/{invitation_id}/")


def register(tool) -> None:
    """Register this module's tools with their read-only/destructive/idempotent hints."""
    tool(read_only=True, title="List project members")(list_project_members)
    tool(read_only=False, title="Add project member")(add_project_member)
    tool(read_only=False, idempotent=True, title="Update project member")(update_project_member)
    tool(read_only=False, destructive=True, idempotent=True, title="Remove project member")(remove_project_member)
    tool(read_only=True, title="List workspace invitations")(list_workspace_invitations)
    tool(read_only=False, title="Invite workspace member")(invite_workspace_member)
    tool(read_only=False, destructive=True, idempotent=True, title="Cancel workspace invitation")(
        cancel_workspace_invitation
    )
