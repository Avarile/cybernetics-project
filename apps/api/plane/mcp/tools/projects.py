# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tools for projects and project metadata (states, labels, members).

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
from plane.mcp.schemas import Cursor, PerPage, ProjectId, WorkspaceSlug
from plane.mcp.tools.common import compact, page_params, project_path

PROJECT_LIST_FIELDS = "id,identifier,name,description,network,archived_at,created_at"  # compact ?fields= projection for list_projects


async def list_projects(workspace_slug: WorkspaceSlug, cursor: Cursor = None, per_page: PerPage = 50) -> dict:
    """List the projects in a workspace that the current user can access (id, identifier, name)."""
    params = page_params(cursor, per_page, fields=PROJECT_LIST_FIELDS)
    return await api().get(f"workspaces/{workspace_slug}/projects/", params=params)


async def get_project(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """Get the full details of a project."""
    return await api().get(f"{project_path(workspace_slug, project_id)}/")


async def list_states(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """List a project's workflow states (id, name, group). Use the id as state_id for work items."""
    return await api().get(f"{project_path(workspace_slug, project_id)}/states/", params={"per_page": 100})


async def list_labels(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """List a project's labels (id, name, color, parent). Use the ids as label_ids for work items."""
    return await api().get(f"{project_path(workspace_slug, project_id)}/labels/", params={"per_page": 100})


async def list_project_members(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """List a project's members. Use their user ids as assignee_ids for work items."""
    return await api().get(f"{project_path(workspace_slug, project_id)}/members/")


async def create_label(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    name: Annotated[str, Field(min_length=1, max_length=255)],
    color: Annotated[Optional[str], Field(description="Hex color, e.g. '#ff7700'")] = None,
    description: Optional[str] = None,
    parent_id: Annotated[Optional[UUID], Field(description="Parent label id, to create a nested label")] = None,
) -> dict:
    """Create a label in a project."""
    body = compact(name=name, color=color, description=description, parent=parent_id)
    return await api().post(f"{project_path(workspace_slug, project_id)}/labels/", body)


def register(tool) -> None:
    """Register this module's tools."""
    tool(read_only=True, title="List projects")(list_projects)
    tool(read_only=True, title="Get project")(get_project)
    tool(read_only=True, title="List states")(list_states)
    tool(read_only=True, title="List labels")(list_labels)
    tool(read_only=True, title="List project members")(list_project_members)
    tool(read_only=False, title="Create label")(create_label)
