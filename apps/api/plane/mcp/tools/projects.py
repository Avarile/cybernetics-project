# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tools for the project lifecycle: list, read, create, update, archive and delete projects.

States and labels live in ``project_setup``, members in ``members``.

Note: each tool function's docstring is sent to MCP clients as the tool description,
so edit those docstrings as user-facing text.
"""

# Python imports
from typing import Annotated, Literal, Optional
from uuid import UUID

# Third party imports
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

# Module imports
from plane.mcp.client import api
from plane.mcp.schemas import Cursor, PerPage, ProjectId, ProjectIdentifier, WorkspaceSlug
from plane.mcp.tools.common import compact, page_params, project_path, update_body

PROJECT_LIST_FIELDS = "id,identifier,name,description,network,archived_at,created_at"  # compact ?fields= projection for list_projects

ProjectName = Annotated[str, Field(min_length=1, max_length=255)]
LeadId = Annotated[Optional[UUID], Field(description="User id of the project lead (made a project admin)")]
DefaultAssigneeId = Annotated[Optional[UUID], Field(description="User id assigned to new work items by default")]
SummaryField = Literal["members", "states", "labels", "cycles", "modules", "issues", "intakes", "pages"]
AutoMonths = Annotated[Optional[int], Field(ge=0, le=12, description="Months, 0 to turn off")]


async def list_projects(workspace_slug: WorkspaceSlug, cursor: Cursor = None, per_page: PerPage = 50) -> dict:
    """List the projects in a workspace that the current user can access (id, identifier, name)."""
    params = page_params(cursor, per_page, fields=PROJECT_LIST_FIELDS)
    return await api().get(f"workspaces/{workspace_slug}/projects/", params=params)


async def get_project(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """Get the full details of a project."""
    return await api().get(f"{project_path(workspace_slug, project_id)}/")


async def get_project_summary(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    fields: Annotated[Optional[list[SummaryField]], Field(description="Counts to include; omit for all")] = None,
) -> dict:
    """Get a project's counts (members, states, labels, cycles, modules, work items, intake items)."""
    params = {"fields": ",".join(fields) if fields else None}
    return await api().get(f"{project_path(workspace_slug, project_id)}/summary/", params=params)


async def create_project(
    workspace_slug: WorkspaceSlug,
    name: ProjectName,
    identifier: ProjectIdentifier,
    description: Optional[str] = None,
    project_lead_id: LeadId = None,
    default_assignee_id: DefaultAssigneeId = None,
    cycles_enabled: bool = True,
    modules_enabled: bool = True,
    intake_enabled: bool = False,
    timezone: Annotated[Optional[str], Field(description="IANA timezone, e.g. 'Europe/Berlin'")] = None,
) -> dict:
    """
    Create a project. You become its admin and it gets the default workflow states
    (Backlog, Todo, In Progress, Done, Cancelled). Cycles and modules are enabled unless
    turned off; enable intake to accept triage submissions. Workspace guests cannot create projects.
    """
    body = compact(
        name=name,
        identifier=identifier,
        description=description,
        project_lead=project_lead_id,
        default_assignee=default_assignee_id,
        cycle_view=cycles_enabled,
        module_view=modules_enabled,
        intake_view=intake_enabled,
        timezone=timezone,
    )
    return await api().post(f"workspaces/{workspace_slug}/projects/", body)


async def update_project(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    name: Optional[ProjectName] = None,
    identifier: Optional[ProjectIdentifier] = None,
    description: Optional[str] = None,
    project_lead_id: LeadId = None,
    default_assignee_id: DefaultAssigneeId = None,
    cycles_enabled: Optional[bool] = None,
    modules_enabled: Optional[bool] = None,
    intake_enabled: Optional[bool] = None,
    estimate_id: Annotated[
        Optional[UUID], Field(description="Activate this estimate for the project (see get_estimate)")
    ] = None,
    archive_in: Annotated[AutoMonths, Field(description="Auto-archive closed work items after N months")] = None,
    close_in: Annotated[AutoMonths, Field(description="Auto-close inactive work items after N months")] = None,
    timezone: Optional[str] = None,
) -> dict:
    """Update a project's settings. Only the fields you pass change. Archived projects cannot be edited."""
    body = update_body(
        name=name,
        identifier=identifier,
        description=description,
        project_lead=project_lead_id,
        default_assignee=default_assignee_id,
        cycle_view=cycles_enabled,
        module_view=modules_enabled,
        intake_view=intake_enabled,
        estimate=estimate_id,
        archive_in=archive_in,
        close_in=close_in,
        timezone=timezone,
    )
    return await api().patch(f"{project_path(workspace_slug, project_id)}/", body)


async def delete_project(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    confirm_identifier: Annotated[
        str, Field(min_length=1, max_length=12, description="The project's identifier, e.g. 'WEB', to confirm")
    ],
) -> dict:
    """
    Permanently delete a project and everything in it (work items, cycles, modules, ...).
    This cannot be undone. Pass the project's identifier as confirm_identifier; the call is
    refused if it does not match. Only project admins can do this.
    """
    project = await api().get(f"{project_path(workspace_slug, project_id)}/")
    actual = str(project.get("identifier", ""))
    if confirm_identifier.strip().upper() != actual.upper():
        raise ToolError(
            f"Refusing to delete: confirm_identifier '{confirm_identifier}' does not match the project's "
            f"identifier '{actual}'"
        )
    return await api().delete(f"{project_path(workspace_slug, project_id)}/")


async def archive_project(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """Archive a project: it is hidden from active project lists and becomes read-only."""
    return await api().post(f"{project_path(workspace_slug, project_id)}/archive/", {})


async def unarchive_project(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """Restore an archived project."""
    return await api().delete(f"{project_path(workspace_slug, project_id)}/archive/")


def register(tool) -> None:
    """Register this module's tools with their read-only/destructive/idempotent hints."""
    tool(read_only=True, title="List projects")(list_projects)
    tool(read_only=True, title="Get project")(get_project)
    tool(read_only=True, title="Get project summary")(get_project_summary)
    tool(read_only=False, title="Create project")(create_project)
    tool(read_only=False, idempotent=True, title="Update project")(update_project)
    tool(read_only=False, destructive=True, idempotent=True, title="Delete project")(delete_project)
    tool(read_only=False, idempotent=True, title="Archive project")(archive_project)
    tool(read_only=False, idempotent=True, title="Unarchive project")(unarchive_project)
