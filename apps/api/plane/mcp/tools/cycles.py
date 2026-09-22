# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from typing import Annotated, Optional
from uuid import UUID

# Third party imports
from pydantic import Field

# Module imports
from plane.mcp.client import api
from plane.mcp.schemas import Cursor, CycleId, CycleView, PerPage, ProjectId, WorkItemId, WorkspaceSlug
from plane.mcp.tools.common import WORK_ITEM_LIST_FIELDS, compact, page_params, project_path

CycleDate = Annotated[
    Optional[str],
    Field(description="ISO date or datetime, e.g. '2026-10-01'", pattern=r"^\d{4}-\d{2}-\d{2}([T ].*)?$"),
]


def cycle_path(workspace_slug: str, project_id: UUID, cycle_id: Optional[UUID] = None) -> str:
    base = f"{project_path(workspace_slug, project_id)}/cycles"
    return f"{base}/{cycle_id}" if cycle_id else base


async def list_cycles(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    cycle_view: CycleView = "all",
    cursor: Cursor = None,
    per_page: PerPage = 50,
) -> dict:
    """List a project's cycles (sprints). cycle_view='current' returns the active cycle."""
    params = page_params(cursor, per_page, cycle_view=cycle_view)
    return await api().get(f"{cycle_path(workspace_slug, project_id)}/", params=params)


async def get_cycle(workspace_slug: WorkspaceSlug, project_id: ProjectId, cycle_id: CycleId) -> dict:
    """Get a cycle with its progress counters."""
    return await api().get(f"{cycle_path(workspace_slug, project_id, cycle_id)}/")


async def create_cycle(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    name: Annotated[str, Field(min_length=1, max_length=255)],
    description: Optional[str] = None,
    start_date: CycleDate = None,
    end_date: CycleDate = None,
) -> dict:
    """Create a cycle. Pass both start_date and end_date, or neither (a draft cycle)."""
    body = compact(name=name, description=description, start_date=start_date, end_date=end_date)
    return await api().post(f"{cycle_path(workspace_slug, project_id)}/", body)


async def list_cycle_work_items(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    cycle_id: CycleId,
    cursor: Cursor = None,
    per_page: PerPage = 50,
) -> dict:
    """List the work items in a cycle."""
    params = page_params(cursor, per_page, fields=WORK_ITEM_LIST_FIELDS)
    return await api().get(f"{cycle_path(workspace_slug, project_id, cycle_id)}/cycle-issues/", params=params)


async def add_work_items_to_cycle(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    cycle_id: CycleId,
    work_item_ids: Annotated[list[UUID], Field(min_length=1)],
) -> dict:
    """Add work items to a cycle. A work item belongs to one cycle, so this moves it from any other cycle."""
    path = f"{cycle_path(workspace_slug, project_id, cycle_id)}/cycle-issues/"
    return await api().post(path, compact(issues=work_item_ids))


async def remove_work_item_from_cycle(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    cycle_id: CycleId,
    work_item_id: WorkItemId,
) -> dict:
    """Remove a work item from a cycle (the work item itself is kept)."""
    return await api().delete(f"{cycle_path(workspace_slug, project_id, cycle_id)}/cycle-issues/{work_item_id}/")


def register(tool) -> None:
    tool(read_only=True, title="List cycles")(list_cycles)
    tool(read_only=True, title="Get cycle")(get_cycle)
    tool(read_only=False, title="Create cycle")(create_cycle)
    tool(read_only=True, title="List cycle work items")(list_cycle_work_items)
    tool(read_only=False, idempotent=True, title="Add work items to cycle")(add_work_items_to_cycle)
    tool(read_only=False, destructive=True, idempotent=True, title="Remove work item from cycle")(
        remove_work_item_from_cycle
    )
