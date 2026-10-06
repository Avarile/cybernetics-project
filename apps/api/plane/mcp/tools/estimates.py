# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tools for a project's estimate system and its estimate points.

A project has at most one estimate. Typical flow: create_estimate -> create_estimate_points ->
update_project(estimate_id=...) to activate it -> update_work_item(estimate_point_id=...).

Note: each tool function's docstring is sent to MCP clients as the tool description,
so edit those docstrings as user-facing text.
"""

# Python imports
from typing import Annotated, Optional
from uuid import UUID

# Third party imports
from pydantic import BaseModel, Field

# Module imports
from plane.mcp.client import api
from plane.mcp.schemas import EstimatePointId, EstimateType, ProjectId, WorkspaceSlug
from plane.mcp.tools.common import compact, project_path, update_body

EstimateIdArg = Annotated[UUID, Field(description="Estimate ID (see get_estimate)")]
PointValue = Annotated[str, Field(min_length=1, max_length=20, description="Shown value, e.g. '3' or 'M'")]
PointKey = Annotated[int, Field(ge=0, description="Sort position, starting at 0")]


class EstimatePointInput(BaseModel):
    """One estimate point to create."""

    key: PointKey
    value: PointValue
    description: Optional[str] = None


def estimate_path(workspace_slug: str, project_id: UUID) -> str:
    """Relative API path of a project's estimate."""
    return f"{project_path(workspace_slug, project_id)}/estimates/"


def points_path(workspace_slug: str, project_id: UUID, estimate_id: UUID, point_id: Optional[UUID] = None) -> str:
    """Relative API path of an estimate's points, or of one point."""
    base = f"{project_path(workspace_slug, project_id)}/estimates/{estimate_id}/estimate-points"
    return f"{base}/{point_id}/" if point_id else f"{base}/"


async def get_estimate(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """Get the project's estimate system (id, name, type). Fails with 404 if it has none."""
    return await api().get(estimate_path(workspace_slug, project_id))


async def create_estimate(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    name: Annotated[str, Field(min_length=1, max_length=255)],
    type: Annotated[EstimateType, Field(description="'points' for numbers, 'categories' for sizes like S/M/L")],
    description: Optional[str] = None,
) -> dict:
    """
    Create the project's estimate system, then add its values with create_estimate_points and
    activate it with update_project(estimate_id=...). A project can only have one estimate.
    """
    body = compact(name=name, type=type, description=description)
    return await api().post(estimate_path(workspace_slug, project_id), body)


async def update_estimate(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    name: Annotated[Optional[str], Field(min_length=1, max_length=255)] = None,
    description: Optional[str] = None,
) -> dict:
    """Rename the project's estimate or change its description."""
    return await api().patch(estimate_path(workspace_slug, project_id), update_body(name=name, description=description))


async def delete_estimate(workspace_slug: WorkspaceSlug, project_id: ProjectId) -> dict:
    """Delete the project's estimate system and all of its points."""
    return await api().delete(estimate_path(workspace_slug, project_id))


async def list_estimate_points(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, estimate_id: EstimateIdArg
) -> dict:
    """List an estimate's points. Use their ids as estimate_point_id for work items."""
    return await api().get(points_path(workspace_slug, project_id, estimate_id))


async def create_estimate_points(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    estimate_id: EstimateIdArg,
    points: Annotated[list[EstimatePointInput], Field(min_length=1, max_length=20)],
) -> dict:
    """Add points to an estimate in one call, e.g. [{key: 0, value: '1'}, {key: 1, value: '2'}]."""
    body = [point.model_dump(exclude_none=True) for point in points]
    return await api().post(points_path(workspace_slug, project_id, estimate_id), body)


async def update_estimate_point(
    workspace_slug: WorkspaceSlug,
    project_id: ProjectId,
    estimate_id: EstimateIdArg,
    estimate_point_id: EstimatePointId,
    value: Optional[PointValue] = None,
    key: Optional[PointKey] = None,
    description: Optional[str] = None,
) -> dict:
    """Change an estimate point's value, position or description."""
    body = update_body(value=value, key=key, description=description)
    return await api().patch(points_path(workspace_slug, project_id, estimate_id, estimate_point_id), body)


async def delete_estimate_point(
    workspace_slug: WorkspaceSlug, project_id: ProjectId, estimate_id: EstimateIdArg, estimate_point_id: EstimatePointId
) -> dict:
    """Delete an estimate point."""
    return await api().delete(points_path(workspace_slug, project_id, estimate_id, estimate_point_id))


def register(tool) -> None:
    """Register this module's tools with their read-only/destructive/idempotent hints."""
    tool(read_only=True, title="Get estimate")(get_estimate)
    tool(read_only=False, title="Create estimate")(create_estimate)
    tool(read_only=False, idempotent=True, title="Update estimate")(update_estimate)
    tool(read_only=False, destructive=True, idempotent=True, title="Delete estimate")(delete_estimate)
    tool(read_only=True, title="List estimate points")(list_estimate_points)
    tool(read_only=False, title="Create estimate points")(create_estimate_points)
    tool(read_only=False, idempotent=True, title="Update estimate point")(update_estimate_point)
    tool(read_only=False, destructive=True, idempotent=True, title="Delete estimate point")(delete_estimate_point)
