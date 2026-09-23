# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tools for project modules (feature groupings) and their work items.

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
from plane.mcp.schemas import (
    Cursor,
    DateString,
    ModuleId,
    ModuleStatus,
    PerPage,
    ProjectId,
    WorkItemId,
    WorkspaceSlug,
)
from plane.mcp.tools.common import WORK_ITEM_LIST_FIELDS, compact, page_params, project_path


def module_path(workspace_slug: str, project_id: UUID, module_id: Optional[UUID] = None) -> str:
    """Relative API path of a project's modules, or of one module when ``module_id`` is given."""
    base = f"{project_path(workspace_slug, project_id)}/modules"
    return f"{base}/{module_id}" if module_id else base


async def list_modules(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    cursor: Cursor = None,
    per_page: PerPage = 50,
) -> dict:
    """List a project's modules (feature groupings) with their status and progress."""
    return await api().get(f"{module_path(workspace_slug, project_id)}/", params=page_params(cursor, per_page))


async def create_module(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    name: Annotated[str, Field(min_length=1, max_length=255)],
    description: Optional[str] = None,
    status: Optional[ModuleStatus] = None,
    start_date: Optional[DateString] = None,
    target_date: Optional[DateString] = None,
    lead_id: Annotated[Optional[UUID], Field(description="User id of the module lead")] = None,
    member_ids: Optional[list[UUID]] = None,
) -> dict:
    """Create a module in a project."""
    body = compact(
        name=name,
        description=description,
        status=status,
        start_date=start_date,
        target_date=target_date,
        lead=lead_id,
        members=member_ids,
    )
    return await api().post(f"{module_path(workspace_slug, project_id)}/", body)


async def list_module_work_items(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    module_id: ModuleId,
    cursor: Cursor = None,
    per_page: PerPage = 50,
) -> dict:
    """List the work items in a module."""
    params = page_params(cursor, per_page, fields=WORK_ITEM_LIST_FIELDS)
    return await api().get(f"{module_path(workspace_slug, project_id, module_id)}/module-issues/", params=params)


async def add_work_items_to_module(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    module_id: ModuleId,
    work_item_ids: Annotated[list[UUID], Field(min_length=1)],
) -> dict:
    """Add work items to a module. A work item can belong to several modules."""
    path = f"{module_path(workspace_slug, project_id, module_id)}/module-issues/"
    return await api().post(path, compact(issues=work_item_ids))


async def remove_work_item_from_module(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    module_id: ModuleId,
    work_item_id: WorkItemId,
) -> dict:
    """Remove a work item from a module (the work item itself is kept)."""
    return await api().delete(f"{module_path(workspace_slug, project_id, module_id)}/module-issues/{work_item_id}/")


def register(tool) -> None:
    """Register this module's tools with their read-only/destructive/idempotent hints."""
    tool(read_only=True, title="List modules")(list_modules)
    tool(read_only=False, title="Create module")(create_module)
    tool(read_only=True, title="List module work items")(list_module_work_items)
    tool(read_only=False, idempotent=True, title="Add work items to module")(add_work_items_to_module)
    tool(read_only=False, destructive=True, idempotent=True, title="Remove work item from module")(
        remove_work_item_from_module
    )
