# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from typing import Annotated, Optional

# Third party imports
from pydantic import Field

# Module imports
from plane.mcp.client import api
from plane.mcp.schemas import HtmlText, Priority, ProjectId, WorkspaceSlug
from plane.mcp.tools.common import compact, project_path


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
    return await api().post(f"{project_path(workspace_slug, project_id)}/intake-issues/", body)


def register(tool) -> None:
    tool(read_only=False, title="Submit to intake")(create_intake_work_item)
