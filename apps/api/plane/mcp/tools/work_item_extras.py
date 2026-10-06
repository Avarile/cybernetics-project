# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tools for work item comments, activity history, links, attachments and relations.

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
    AttachmentId,
    CommentId,
    Cursor,
    HtmlText,
    LinkId,
    PerPage,
    ProjectId,
    RelationType,
    WorkItemId,
    WorkspaceSlug,
)
from plane.mcp.tools.common import compact, page_params, update_body, work_item_path

LinkUrl = Annotated[str, Field(min_length=1, max_length=2048, description="Absolute URL, e.g. a PR or doc")]


def sub_path(workspace_slug: str, project_id: UUID, work_item_id: UUID, kind: str, pk: Optional[UUID] = None) -> str:
    """Relative API path of a work item sub-resource collection (``comments``, ``links``, ...), or one item of it."""
    base = f"{work_item_path(workspace_slug, project_id, work_item_id)}/{kind}"
    return f"{base}/{pk}/" if pk else f"{base}/"


async def list_work_item_comments(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    work_item_id: WorkItemId,
    cursor: Cursor = None,
    per_page: PerPage = 50,
) -> dict:
    """List the comments on a work item."""
    path = f"{work_item_path(workspace_slug, project_id, work_item_id)}/comments/"
    return await api().get(path, params=page_params(cursor, per_page))


async def add_work_item_comment(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    work_item_id: WorkItemId,
    comment_html: HtmlText,
) -> dict:
    """Add a comment to a work item."""
    path = f"{work_item_path(workspace_slug, project_id, work_item_id)}/comments/"
    return await api().post(path, {"comment_html": comment_html})


async def update_work_item_comment(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    work_item_id: WorkItemId,
    comment_id: CommentId,
    comment_html: HtmlText,
) -> dict:
    """Replace a comment's text."""
    path = sub_path(workspace_slug, project_id, work_item_id, "comments", comment_id)
    return await api().patch(path, {"comment_html": comment_html})


async def delete_work_item_comment(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, work_item_id: WorkItemId, comment_id: CommentId
) -> dict:
    """Delete a comment from a work item."""
    return await api().delete(sub_path(workspace_slug, project_id, work_item_id, "comments", comment_id))


async def list_work_item_activities(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    work_item_id: WorkItemId,
    cursor: Cursor = None,
    per_page: PerPage = 50,
) -> dict:
    """List the change history of a work item (who changed which field, old and new values)."""
    path = f"{work_item_path(workspace_slug, project_id, work_item_id)}/activities/"
    return await api().get(path, params=page_params(cursor, per_page))


async def add_work_item_link(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    work_item_id: WorkItemId,
    url: LinkUrl,
    title: Optional[str] = None,
) -> dict:
    """Attach an external link (pull request, document, ...) to a work item."""
    path = f"{work_item_path(workspace_slug, project_id, work_item_id)}/links/"
    return await api().post(path, compact(url=url, title=title))


async def list_work_item_links(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    work_item_id: WorkItemId,
    cursor: Cursor = None,
    per_page: PerPage = 50,
) -> dict:
    """List the external links attached to a work item."""
    path = sub_path(workspace_slug, project_id, work_item_id, "links")
    return await api().get(path, params=page_params(cursor, per_page))


async def update_work_item_link(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    work_item_id: WorkItemId,
    link_id: LinkId,
    url: Optional[LinkUrl] = None,
    title: Optional[str] = None,
) -> dict:
    """Change a link's URL or title."""
    path = sub_path(workspace_slug, project_id, work_item_id, "links", link_id)
    return await api().patch(path, update_body(url=url, title=title))


async def delete_work_item_link(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, work_item_id: WorkItemId, link_id: LinkId
) -> dict:
    """Remove a link from a work item."""
    return await api().delete(sub_path(workspace_slug, project_id, work_item_id, "links", link_id))


async def list_work_item_attachments(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, work_item_id: WorkItemId
) -> dict:
    """List a work item's file attachments (name, size, type, uploader). Uploading is not supported here."""
    return await api().get(sub_path(workspace_slug, project_id, work_item_id, "attachments"))


async def delete_work_item_attachment(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, work_item_id: WorkItemId, attachment_id: AttachmentId
) -> dict:
    """Delete a file attachment from a work item."""
    return await api().delete(sub_path(workspace_slug, project_id, work_item_id, "attachments", attachment_id))


async def list_work_item_relations(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, work_item_id: WorkItemId
) -> dict:
    """List a work item's relations (blocking, blocked_by, duplicate, relates_to, ...)."""
    path = f"{work_item_path(workspace_slug, project_id, work_item_id)}/relations/"
    return await api().get(path)


async def add_work_item_relation(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    work_item_id: WorkItemId,
    relation_type: RelationType,
    related_work_item_ids: Annotated[list[UUID], Field(min_length=1)],
) -> dict:
    """Relate a work item to other work items, e.g. relation_type='blocked_by'."""
    path = f"{work_item_path(workspace_slug, project_id, work_item_id)}/relations/"
    return await api().post(path, compact(relation_type=relation_type, issues=related_work_item_ids))


def register(tool) -> None:
    """Register this module's tools."""
    tool(read_only=True, title="List work item comments")(list_work_item_comments)
    tool(read_only=False, title="Add work item comment")(add_work_item_comment)
    tool(read_only=True, title="List work item activities")(list_work_item_activities)
    tool(read_only=False, title="Add work item link")(add_work_item_link)
    tool(read_only=False, idempotent=True, title="Update work item comment")(update_work_item_comment)
    tool(read_only=False, destructive=True, idempotent=True, title="Delete work item comment")(delete_work_item_comment)
    tool(read_only=True, title="List work item links")(list_work_item_links)
    tool(read_only=False, idempotent=True, title="Update work item link")(update_work_item_link)
    tool(read_only=False, destructive=True, idempotent=True, title="Delete work item link")(delete_work_item_link)
    tool(read_only=True, title="List work item attachments")(list_work_item_attachments)
    tool(read_only=False, destructive=True, idempotent=True, title="Delete work item attachment")(
        delete_work_item_attachment
    )
    tool(read_only=True, title="List work item relations")(list_work_item_relations)
    tool(read_only=False, title="Add work item relation")(add_work_item_relation)
