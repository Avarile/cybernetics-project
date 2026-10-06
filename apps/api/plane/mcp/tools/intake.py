# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tools for a project's intake (triage) queue: submit, list, read, triage and delete.

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
from plane.mcp.schemas import Cursor, HtmlText, PerPage, Priority, ProjectId, WorkItemId, WorkspaceSlug
from plane.mcp.tools.common import compact, page_params, project_path

IntakeAction = Literal["accept", "reject", "snooze", "duplicate", "pending"]
# IntakeIssue.status values
INTAKE_STATUS = {"pending": -2, "reject": -1, "snooze": 0, "accept": 1, "duplicate": 2}
IntakeWorkItemId = Annotated[UUID, Field(description="The intake item's work item id (see list_intake_work_items)")]


def intake_path(workspace_slug: str, project_id: UUID, work_item_id: Optional[UUID] = None) -> str:
    """Relative API path of a project's intake queue, or of one intake item (keyed by its work item id)."""
    base = f"{project_path(workspace_slug, project_id)}/intake-issues"
    return f"{base}/{work_item_id}/" if work_item_id else f"{base}/"


async def create_intake_work_item(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    name: Annotated[str, Field(min_length=1, max_length=255)],
    description_html: Optional[HtmlText] = None,
    priority: Priority = "none",
) -> dict:
    """
    Submit a work item to a project's intake queue for triage (for example a bug report).
    The project must have intake enabled.
    """
    body = {"issue": compact(name=name, description_html=description_html, priority=priority)}
    return await api().post(intake_path(workspace_slug, project_id), body)


async def list_intake_work_items(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, cursor: Cursor = None, per_page: PerPage = 50
) -> dict:
    """List the items in a project's intake queue with their triage status."""
    return await api().get(intake_path(workspace_slug, project_id), params=page_params(cursor, per_page))


async def get_intake_work_item(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, work_item_id: IntakeWorkItemId
) -> dict:
    """Get one intake item with its triage status and work item details."""
    return await api().get(intake_path(workspace_slug, project_id, work_item_id))


async def triage_intake_work_item(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    work_item_id: IntakeWorkItemId,
    action: IntakeAction,
    snoozed_till: Annotated[
        Optional[str],
        Field(
            description="Required for 'snooze': ISO datetime, e.g. '2026-11-01T09:00:00Z'",
            pattern=r"^\d{4}-\d{2}-\d{2}",
        ),
    ] = None,
    duplicate_of_id: Annotated[
        Optional[WorkItemId], Field(description="Required for 'duplicate': the work item it duplicates")
    ] = None,
) -> dict:
    """
    Triage an intake item: 'accept' moves it into the project as a regular work item, 'reject'
    declines it, 'snooze' hides it until snoozed_till, 'duplicate' marks it as a duplicate of
    duplicate_of_id, 'pending' puts it back in the queue. Only project admins can triage.
    """
    if action == "snooze" and not snoozed_till:
        raise ToolError("snoozed_till is required when action is 'snooze'")
    if action == "duplicate" and not duplicate_of_id:
        raise ToolError("duplicate_of_id is required when action is 'duplicate'")
    body = compact(
        status=INTAKE_STATUS[action],
        snoozed_till=snoozed_till if action == "snooze" else None,
        duplicate_to=duplicate_of_id if action == "duplicate" else None,
    )
    result = await api().patch(intake_path(workspace_slug, project_id, work_item_id), body)
    # The API answers 200 but ignores the status change when the caller is not a project admin
    if result.get("status") != INTAKE_STATUS[action]:
        raise ToolError("The triage status was not changed: only project admins can triage intake items")
    return result


async def delete_intake_work_item(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, work_item_id: IntakeWorkItemId
) -> dict:
    """Delete an intake item. Its work item is deleted too unless it was already accepted."""
    return await api().delete(intake_path(workspace_slug, project_id, work_item_id))


def register(tool) -> None:
    """Register this module's tools with their read-only/destructive/idempotent hints."""
    tool(read_only=False, title="Submit to intake")(create_intake_work_item)
    tool(read_only=True, title="List intake work items")(list_intake_work_items)
    tool(read_only=True, title="Get intake work item")(get_intake_work_item)
    tool(read_only=False, idempotent=True, title="Triage intake work item")(triage_intake_work_item)
    tool(read_only=False, destructive=True, idempotent=True, title="Delete intake work item")(delete_intake_work_item)
