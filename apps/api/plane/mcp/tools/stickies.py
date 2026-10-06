# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tools for the current user's workspace stickies (personal quick notes).

Note: each tool function's docstring is sent to MCP clients as the tool description,
so edit those docstrings as user-facing text.
"""

# Python imports
from typing import Annotated, Optional

# Third party imports
from pydantic import Field

# Module imports
from plane.mcp.client import api
from plane.mcp.schemas import Cursor, HexColor, HtmlText, PerPage, StickyId, WorkspaceSlug
from plane.mcp.tools.common import compact, page_params, update_body

StickyName = Annotated[str, Field(max_length=255)]


def sticky_path(workspace_slug: str, sticky_id: Optional[str] = None) -> str:
    """Relative API path of the workspace's stickies, or of one sticky."""
    base = f"workspaces/{workspace_slug}/stickies"
    return f"{base}/{sticky_id}/" if sticky_id else f"{base}/"


async def list_stickies(workspace_slug: WorkspaceSlug, cursor: Cursor = None, per_page: PerPage = 50) -> dict:
    """List your stickies (personal notes) in a workspace."""
    return await api().get(sticky_path(workspace_slug), params=page_params(cursor, per_page))


async def create_sticky(
    workspace_slug: WorkspaceSlug,
    description_html: HtmlText,
    name: Optional[StickyName] = None,
    background_color: Optional[HexColor] = None,
) -> dict:
    """Create a sticky (a personal note visible only to you)."""
    body = compact(name=name, description_html=description_html, background_color=background_color)
    return await api().post(sticky_path(workspace_slug), body)


async def update_sticky(
    workspace_slug: WorkspaceSlug,
    sticky_id: StickyId,
    description_html: Optional[HtmlText] = None,
    name: Optional[StickyName] = None,
    background_color: Optional[HexColor] = None,
) -> dict:
    """Update a sticky. Only the fields you pass change."""
    body = update_body(name=name, description_html=description_html, background_color=background_color)
    return await api().patch(sticky_path(workspace_slug, str(sticky_id)), body)


async def delete_sticky(workspace_slug: WorkspaceSlug, sticky_id: StickyId) -> dict:
    """Delete a sticky."""
    return await api().delete(sticky_path(workspace_slug, str(sticky_id)))


def register(tool) -> None:
    """Register this module's tools with their read-only/destructive/idempotent hints."""
    tool(read_only=True, title="List stickies")(list_stickies)
    tool(read_only=False, title="Create sticky")(create_sticky)
    tool(read_only=False, idempotent=True, title="Update sticky")(update_sticky)
    tool(read_only=False, destructive=True, idempotent=True, title="Delete sticky")(delete_sticky)
