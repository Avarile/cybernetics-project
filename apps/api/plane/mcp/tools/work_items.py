# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from typing import Annotated, Literal, Optional
from uuid import UUID

# Third party imports
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

# Module imports
from plane.mcp.auth import get_caller
from plane.mcp.client import api
from plane.mcp.schemas import (
    DateString,
    HtmlText,
    Priority,
    ProjectId,
    StateGroup,
    WorkItemId,
    WorkItemKey,
    WorkspaceSlug,
)
from plane.mcp.services import db_call
from plane.mcp.services.work_item_query import WorkItemQuery, query_work_items
from plane.mcp.tools.common import compact, project_path, work_item_path

OrderBy = Literal[
    "-updated_at",
    "updated_at",
    "-created_at",
    "created_at",
    "priority",
    "-priority",
    "target_date",
    "-target_date",
    "sequence_id",
    "-sequence_id",
    "state__group",
    "-state__group",
]
AssigneeFilter = Annotated[
    str,
    Field(
        description="A user id, 'me' for the current user, or 'none' for unassigned work items",
        pattern=r"^(me|none|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$",
    ),
]
WorkItemName = Annotated[str, Field(min_length=1, max_length=255)]
AssigneeIds = Annotated[Optional[list[UUID]], Field(description="User ids (see list_project_members)")]
LabelIds = Annotated[Optional[list[UUID]], Field(description="Label ids (see list_labels)")]
StateId = Annotated[Optional[UUID], Field(description="State id (see list_states)")]
ParentId = Annotated[Optional[UUID], Field(description="Parent work item id, to create a sub-work item")]


async def list_work_items(
    workspace_slug: WorkspaceSlug,
    project_id: Annotated[
        Optional[UUID], Field(description="Limit to one project; omit to list across projects")
    ] = None,
    assignees: Optional[list[AssigneeFilter]] = None,
    state_ids: Optional[list[UUID]] = None,
    state_groups: Optional[list[StateGroup]] = None,
    priorities: Optional[list[Priority]] = None,
    label_ids: Optional[list[UUID]] = None,
    cycle_id: Optional[UUID] = None,
    module_id: Optional[UUID] = None,
    name_contains: Optional[str] = None,
    order_by: OrderBy = "-updated_at",
    limit: Annotated[int, Field(ge=1, le=100)] = 25,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> dict:
    """
    List work items the current user can see, with optional filters. Filters combine with AND;
    values inside one filter combine with OR. For example assignees=['me'] and
    state_groups=['unstarted', 'started'] lists the user's open work. Returns a page of results,
    the total count and next_offset.
    """
    caller = get_caller()
    query = WorkItemQuery(
        workspace_slug=workspace_slug,
        project_id=str(project_id) if project_id else None,
        assignees=list(assignees or []),
        state_ids=[str(v) for v in state_ids or []],
        state_groups=list(state_groups or []),
        priorities=list(priorities or []),
        label_ids=[str(v) for v in label_ids or []],
        cycle_id=str(cycle_id) if cycle_id else None,
        module_id=str(module_id) if module_id else None,
        name_contains=name_contains,
        order_by=order_by,
        limit=limit,
        offset=offset,
    )
    return await db_call(query_work_items)(caller.user_id, caller.token, query)


async def search_work_items(
    workspace_slug: WorkspaceSlug,
    query: Annotated[str, Field(min_length=1, description="Text to match in the name, or a key such as 'WEB-12'")],
    project_id: Optional[ProjectId] = None,
    limit: Annotated[int, Field(ge=1, le=50)] = 10,
) -> dict:
    """Quick search for work items by name or key, across the workspace or within one project."""
    params = {
        "search": query,
        "limit": limit,
        "project_id": str(project_id) if project_id else None,
        "workspace_search": "false" if project_id else "true",
    }
    return await api().get(f"workspaces/{workspace_slug}/work-items/search/", params=params)


async def get_work_item(
    workspace_slug: WorkspaceSlug,
    key: Optional[WorkItemKey] = None,
    project_id: Optional[ProjectId] = None,
    work_item_id: Optional[WorkItemId] = None,
) -> dict:
    """
    Get a work item with its state, assignees and labels expanded. Pass either its key
    (e.g. 'WEB-123') or both project_id and work_item_id.
    """
    params = {"expand": "state,assignees,labels"}
    if key:
        return await api().get(f"workspaces/{workspace_slug}/work-items/{key.upper()}/", params=params)
    if project_id and work_item_id:
        return await api().get(f"{work_item_path(workspace_slug, project_id, work_item_id)}/", params=params)
    raise ToolError("Pass either key, or both project_id and work_item_id")


async def create_work_item(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    name: WorkItemName,
    description_html: Optional[HtmlText] = None,
    state_id: StateId = None,
    priority: Optional[Priority] = None,
    assignee_ids: AssigneeIds = None,
    label_ids: LabelIds = None,
    parent_id: ParentId = None,
    start_date: Optional[DateString] = None,
    target_date: Optional[DateString] = None,
) -> dict:
    """Create a work item in a project. Unset fields use the project's defaults."""
    body = compact(
        name=name,
        description_html=description_html,
        state=state_id,
        priority=priority,
        assignees=assignee_ids,
        labels=label_ids,
        parent=parent_id,
        start_date=start_date,
        target_date=target_date,
    )
    return await api().post(f"{project_path(workspace_slug, project_id)}/work-items/", body)


async def update_work_item(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    work_item_id: WorkItemId,
    name: Optional[WorkItemName] = None,
    description_html: Optional[HtmlText] = None,
    state_id: StateId = None,
    priority: Optional[Priority] = None,
    assignee_ids: AssigneeIds = None,
    label_ids: LabelIds = None,
    parent_id: ParentId = None,
    start_date: Optional[DateString] = None,
    target_date: Optional[DateString] = None,
) -> dict:
    """
    Update a work item. Only the fields you pass change. assignee_ids and label_ids REPLACE the
    whole set, so include the existing ids you want to keep (see get_work_item).
    """
    body = compact(
        name=name,
        description_html=description_html,
        state=state_id,
        priority=priority,
        assignees=assignee_ids,
        labels=label_ids,
        parent=parent_id,
        start_date=start_date,
        target_date=target_date,
    )
    if not body:
        raise ToolError("Pass at least one field to update")
    return await api().patch(f"{work_item_path(workspace_slug, project_id, work_item_id)}/", body)


async def delete_work_item(workspace_slug: WorkspaceSlug, project_id: ProjectId, work_item_id: WorkItemId) -> dict:
    """Delete a work item. Only its creator or a project admin can do this."""
    return await api().delete(f"{work_item_path(workspace_slug, project_id, work_item_id)}/")


def register(tool) -> None:
    tool(read_only=True, title="List work items")(list_work_items)
    tool(read_only=True, title="Search work items")(search_work_items)
    tool(read_only=True, title="Get work item")(get_work_item)
    tool(read_only=False, title="Create work item")(create_work_item)
    tool(read_only=False, idempotent=True, title="Update work item")(update_work_item)
    tool(read_only=False, destructive=True, idempotent=True, title="Delete work item")(delete_work_item)
