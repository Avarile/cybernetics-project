# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Filtered work item listing.

The public list endpoint does not apply filters, so this read is served
directly. It reuses the app's ``issue_filters`` and ``order_issue_queryset``
helpers and the public API's ``IssueSerializer``, and is scoped exactly like
``ProjectEntityPermission`` for reads: the caller must be an active member of
the work item's project.
"""

# Python imports
from dataclasses import dataclass, field
from typing import Optional

# Django imports
from django.db.models import Exists, OuterRef, Q

# Module imports
from plane.api.serializers import IssueSerializer
from plane.db.models import Issue, IssueAssignee
from plane.mcp.services.throttle import charge_api_key_rate_limit
from plane.utils.issue_filters import issue_filters
from plane.utils.order_queryset import order_issue_queryset

LIST_FIELDS = [
    "id",
    "sequence_id",
    "name",
    "project",
    "state",
    "priority",
    "assignees",
    "labels",
    "parent",
    "start_date",
    "target_date",
    "completed_at",
    "created_at",
    "updated_at",
]


@dataclass
class WorkItemQuery:
    workspace_slug: str
    project_id: Optional[str] = None
    assignees: list[str] = field(default_factory=list)
    state_ids: list[str] = field(default_factory=list)
    state_groups: list[str] = field(default_factory=list)
    priorities: list[str] = field(default_factory=list)
    label_ids: list[str] = field(default_factory=list)
    cycle_id: Optional[str] = None
    module_id: Optional[str] = None
    name_contains: Optional[str] = None
    order_by: str = "-updated_at"
    limit: int = 25
    offset: int = 0


def build_filter_params(query: WorkItemQuery) -> dict:
    """Translate the tool arguments into the query-param shape ``issue_filters`` expects."""
    candidates = {
        "state": ",".join(query.state_ids),
        "state_group": ",".join(query.state_groups),
        "priority": ",".join(query.priorities),
        "labels": ",".join(query.label_ids),
        "cycle": query.cycle_id or "",
        "module": query.module_id or "",
        "name": query.name_contains or "",
    }
    return {key: value for key, value in candidates.items() if value}


def assignee_filter(assignees: list[str], user_id: str) -> Q:
    """
    Match any of the given assignees ("me", "none" or user ids), OR-ed together.

    Not delegated to ``issue_filters``: removing an assignee soft-deletes the
    IssueAssignee row, which its join-based "None" filter still counts, and it
    ANDs "None" with ids. EXISTS over active rows handles both.
    """
    active = IssueAssignee.objects.filter(issue=OuterRef("pk"), deleted_at__isnull=True)
    ids = [user_id if a == "me" else a for a in assignees if a != "none"]
    condition = Q()
    if ids:
        condition |= Q(Exists(active.filter(assignee_id__in=ids)))
    if "none" in assignees:
        condition |= ~Q(Exists(active))
    return condition


def query_work_items(user_id: str, token: str, query: WorkItemQuery) -> dict:
    charge_api_key_rate_limit(token)

    queryset = Issue.issue_objects.filter(
        workspace__slug=query.workspace_slug,
        project__project_projectmember__member_id=user_id,
        project__project_projectmember__is_active=True,
        project__project_projectmember__deleted_at__isnull=True,
        project__archived_at__isnull=True,
    ).filter(**issue_filters(build_filter_params(query), "GET"))

    if query.assignees:
        queryset = queryset.filter(assignee_filter(query.assignees, user_id))

    if query.project_id:
        queryset = queryset.filter(project_id=query.project_id)

    queryset = queryset.select_related("project", "state").distinct()
    queryset, _ = order_issue_queryset(queryset, query.order_by)

    total = queryset.count()
    page = list(queryset[query.offset : query.offset + query.limit])
    results = IssueSerializer(page, many=True, fields=LIST_FIELDS).data

    # Add the human readable key (e.g. WEB-123) the model can use with get_work_item
    for item, issue in zip(results, page):
        item["key"] = f"{issue.project.identifier}-{issue.sequence_id}"
        item["state_name"] = issue.state.name if issue.state else None
        item["state_group"] = issue.state.group if issue.state else None

    next_offset = query.offset + len(page)
    return {
        "results": results,
        "total": total,
        "next_offset": next_offset if next_offset < total else None,
    }
