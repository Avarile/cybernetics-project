# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared tool input types. Every value interpolated into an API path is constrained here."""

# Python imports
from typing import Annotated, Literal, Optional
from uuid import UUID

# Third party imports
from pydantic import Field

WorkspaceSlug = Annotated[
    str,
    Field(
        description="Workspace slug, e.g. 'acme' (see list_workspaces)",
        pattern=r"^[A-Za-z0-9_-]+$",
        max_length=48,
    ),
]
ProjectId = Annotated[UUID, Field(description="Project ID (see list_projects)")]
WorkItemId = Annotated[UUID, Field(description="Work item ID")]
WorkItemKey = Annotated[
    str,
    Field(description="Human readable work item key, e.g. 'WEB-123'", pattern=r"^[A-Za-z0-9]+-\d+$", max_length=24),
]
CycleId = Annotated[UUID, Field(description="Cycle ID (see list_cycles)")]
ModuleId = Annotated[UUID, Field(description="Module ID (see list_modules)")]
StateId = Annotated[UUID, Field(description="State ID (see list_states)")]
LabelId = Annotated[UUID, Field(description="Label ID (see list_labels)")]
UserId = Annotated[UUID, Field(description="User ID (see list_workspace_members / list_project_members)")]
CommentId = Annotated[UUID, Field(description="Comment ID (see list_work_item_comments)")]
LinkId = Annotated[UUID, Field(description="Link ID (see list_work_item_links)")]
AttachmentId = Annotated[UUID, Field(description="Attachment ID (see list_work_item_attachments)")]
EstimatePointId = Annotated[UUID, Field(description="Estimate point ID (see list_estimate_points)")]
InvitationId = Annotated[UUID, Field(description="Invitation ID (see list_workspace_invitations)")]
StickyId = Annotated[UUID, Field(description="Sticky ID (see list_stickies)")]
ProjectIdentifier = Annotated[
    str,
    Field(
        description="Short uppercase project key used in work item keys, e.g. 'WEB' for WEB-123",
        pattern=r"^[A-Z0-9]+$",
        min_length=1,
        max_length=12,
    ),
]

Priority = Literal["urgent", "high", "medium", "low", "none"]
MemberRole = Literal["admin", "member", "guest"]
# Plane's numeric role values (WorkspaceMember / ProjectMember / WorkspaceMemberInvite.role)
ROLE_VALUES = {"admin": 20, "member": 15, "guest": 5}
EstimateType = Literal["categories", "points"]
HexColor = Annotated[str, Field(description="Hex color, e.g. '#ff7700'", pattern=r"^#[0-9A-Fa-f]{6}$")]
StateGroup = Literal["backlog", "unstarted", "started", "completed", "cancelled"]
CycleView = Literal["all", "current", "upcoming", "completed", "draft", "incomplete"]
ModuleStatus = Literal["backlog", "planned", "in-progress", "paused", "completed", "cancelled"]
RelationType = Literal[
    "blocking",
    "blocked_by",
    "duplicate",
    "relates_to",
    "start_before",
    "start_after",
    "finish_before",
    "finish_after",
]

HtmlText = Annotated[
    str,
    Field(description="Rich text as simple HTML, e.g. '<p>Steps:</p><ul><li>Open the page</li></ul>'"),
]
DateString = Annotated[str, Field(description="Date in YYYY-MM-DD format", pattern=r"^\d{4}-\d{2}-\d{2}$")]
Cursor = Annotated[Optional[str], Field(description="Pagination cursor taken from a previous next_cursor")]
PerPage = Annotated[int, Field(ge=1, le=100, description="Page size (1-100)")]
