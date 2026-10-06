# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tools for a project's workflow states and labels.

Note: each tool function's docstring is sent to MCP clients as the tool description,
so edit those docstrings as user-facing text.
"""

# Python imports
from typing import Annotated, Optional
from uuid import UUID

# Third party imports
from pydantic import Field

# Module imports
from plane.mcp.client import api
from plane.mcp.schemas import HexColor, LabelId, ProjectId, StateGroup, StateId, WorkspaceSlug
from plane.mcp.tools.common import compact, project_path, update_body

Name = Annotated[str, Field(min_length=1, max_length=255)]
ParentLabelId = Annotated[Optional[UUID], Field(description="Parent label id, to nest this label")]


def state_path(workspace_slug: str, project_id: UUID, state_id: Optional[UUID] = None) -> str:
    """Relative API path of a project's states, or of one state."""
    base = f"{project_path(workspace_slug, project_id)}/states"
    return f"{base}/{state_id}" if state_id else base


def label_path(workspace_slug: str, project_id: UUID, label_id: Optional[UUID] = None) -> str:
    """Relative API path of a project's labels, or of one label."""
    base = f"{project_path(workspace_slug, project_id)}/labels"
    return f"{base}/{label_id}" if label_id else base


async def list_states(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """List a project's workflow states (id, name, group). Use the id as state_id for work items."""
    return await api().get(f"{state_path(workspace_slug, project_id)}/", params={"per_page": 100})


async def create_state(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    name: Name,
    group: StateGroup,
    color: HexColor,
    description: Optional[str] = None,
    default: Annotated[Optional[bool], Field(description="Make this the state new work items start in")] = None,
) -> dict:
    """Add a workflow state to a project. The group decides how it counts towards progress."""
    body = compact(name=name, group=group, color=color, description=description, default=default)
    return await api().post(f"{state_path(workspace_slug, project_id)}/", body)


async def update_state(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    state_id: StateId,
    name: Optional[Name] = None,
    group: Optional[StateGroup] = None,
    color: Optional[HexColor] = None,
    description: Optional[str] = None,
    default: Optional[bool] = None,
) -> dict:
    """Update a workflow state. Only the fields you pass change."""
    body = update_body(name=name, group=group, color=color, description=description, default=default)
    return await api().patch(f"{state_path(workspace_slug, project_id, state_id)}/", body)


async def delete_state(workspace_slug: WorkspaceSlug, project_id: ProjectId, state_id: StateId) -> dict:
    """Delete a workflow state. The default state and states that still have work items cannot be deleted."""
    return await api().delete(f"{state_path(workspace_slug, project_id, state_id)}/")


async def list_labels(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """List a project's labels (id, name, color, parent). Use the ids as label_ids for work items."""
    return await api().get(f"{label_path(workspace_slug, project_id)}/", params={"per_page": 100})


async def create_label(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    name: Name,
    color: Optional[HexColor] = None,
    description: Optional[str] = None,
    parent_id: ParentLabelId = None,
) -> dict:
    """Create a label in a project."""
    body = compact(name=name, color=color, description=description, parent=parent_id)
    return await api().post(f"{label_path(workspace_slug, project_id)}/", body)


async def update_label(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    label_id: LabelId,
    name: Optional[Name] = None,
    color: Optional[HexColor] = None,
    description: Optional[str] = None,
    parent_id: ParentLabelId = None,
) -> dict:
    """Update a label. Only the fields you pass change."""
    body = update_body(name=name, color=color, description=description, parent=parent_id)
    return await api().patch(f"{label_path(workspace_slug, project_id, label_id)}/", body)


async def delete_label(workspace_slug: WorkspaceSlug, project_id: ProjectId, label_id: LabelId) -> dict:
    """Delete a label. It is removed from every work item that has it."""
    return await api().delete(f"{label_path(workspace_slug, project_id, label_id)}/")


def register(tool) -> None:
    """Register this module's tools with their read-only/destructive/idempotent hints."""
    tool(read_only=True, title="List states")(list_states)
    tool(read_only=False, title="Create state")(create_state)
    tool(read_only=False, idempotent=True, title="Update state")(update_state)
    tool(read_only=False, destructive=True, idempotent=True, title="Delete state")(delete_state)
    tool(read_only=True, title="List labels")(list_labels)
    tool(read_only=False, title="Create label")(create_label)
    tool(read_only=False, idempotent=True, title="Update label")(update_label)
    tool(read_only=False, destructive=True, idempotent=True, title="Delete label")(delete_label)
