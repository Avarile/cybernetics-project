# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Sub-issue (child work item) endpoints.

Lists the children of a parent issue (optionally grouped) together with a
per-state-group distribution, and bulk-assigns existing issues as children of a
parent. Mounted under the project issue routes, e.g.
``workspaces/<slug>/projects/<project_id>/issues/<issue_id>/sub-issues/``.
"""

# Python imports
import json

# Django imports
from django.utils import timezone
from django.db.models import OuterRef, Func, F, Q, Value, UUIDField, Subquery, Count, IntegerField
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models.functions import Coalesce

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseAPIView
from plane.app.serializers import IssueSerializer
from plane.app.permissions import ProjectEntityPermission
from plane.db.models import Issue, IssueLink, FileAsset, CycleIssue, IssueLabel, IssueAssignee, ModuleIssue
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.timezone_converter import user_timezone_converter
from collections import defaultdict
from plane.utils.host import base_host
from plane.utils.order_queryset import order_issue_queryset


class SubIssuesEndpoint(BaseAPIView):
    """List and bulk-attach sub-issues of a parent issue (project entity permission)."""

    permission_classes = [ProjectEntityPermission]

    @method_decorator(gzip_page)
    def get(self, request, slug, project_id, issue_id):
        """Return the sub-issues of ``issue_id`` and their state-group distribution.

        Query params: ``order_by`` (default ``-created_at``) and optional
        ``group_by`` (an issue field name, or ``assignees__ids`` to fan out per
        assignee). Response: ``{"sub_issues": list|dict, "state_distribution": dict}``.
        """
        # Each annotation below is a correlated subquery (rather than a join) so
        # the counts / id arrays don't multiply rows. Coalesce turns "no rows"
        # into 0 or an empty array instead of NULL.
        sub_issues = (
            Issue.issue_objects.filter(parent_id=issue_id, workspace__slug=slug)
            .annotate(
                # An issue belongs to at most one active cycle; take the first match.
                cycle_id=Subquery(
                    CycleIssue.objects.filter(issue=OuterRef("id"), deleted_at__isnull=True).values("cycle_id")[:1]
                )
            )
            .annotate(
                link_count=Coalesce(
                    Subquery(
                        IssueLink.objects.filter(issue=OuterRef("id"))
                        .order_by()
                        .values("issue")
                        .annotate(count=Count("id"))
                        .values("count"),
                        output_field=IntegerField(),
                    ),
                    0,
                )
            )
            .annotate(
                attachment_count=Coalesce(
                    Subquery(
                        FileAsset.objects.filter(
                            issue_id=OuterRef("id"),
                            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                        )
                        .order_by()
                        .values("issue_id")
                        .annotate(count=Count("id"))
                        .values("count"),
                        output_field=IntegerField(),
                    ),
                    0,
                )
            )
            .annotate(
                sub_issues_count=Coalesce(
                    Subquery(
                        Issue.issue_objects.filter(parent=OuterRef("id"))
                        .order_by()
                        .values("parent")
                        .annotate(count=Count("id"))
                        .values("count"),
                        output_field=IntegerField(),
                    ),
                    0,
                )
            )
            .annotate(
                label_ids=Coalesce(
                    Subquery(
                        IssueLabel.objects.filter(issue_id=OuterRef("id"), deleted_at__isnull=True)
                        .order_by()
                        .values("issue_id")
                        .annotate(arr=ArrayAgg("label_id", distinct=True))
                        .values("arr"),
                        output_field=ArrayField(UUIDField()),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    Subquery(
                        IssueAssignee.objects.filter(
                            issue_id=OuterRef("id"),
                            # Only include assignees who are still active project members
                            assignee__member_project__is_active=True,
                            deleted_at__isnull=True,
                        )
                        .order_by()
                        .values("issue_id")
                        .annotate(arr=ArrayAgg("assignee_id", distinct=True))
                        .values("arr"),
                        output_field=ArrayField(UUIDField()),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                module_ids=Coalesce(
                    Subquery(
                        ModuleIssue.objects.filter(
                            issue_id=OuterRef("id"),
                            # Skip archived modules
                            module__archived_at__isnull=True,
                            deleted_at__isnull=True,
                        )
                        .order_by()
                        .values("issue_id")
                        .annotate(arr=ArrayAgg("module_id", distinct=True))
                        .values("arr"),
                        output_field=ArrayField(UUIDField()),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
            .annotate(state_group=F("state__group"))
        )

        # Ordering
        order_by_param = request.GET.get("order_by", "-created_at")
        group_by = request.GET.get("group_by", False)

        if order_by_param:
            sub_issues, order_by_param = order_issue_queryset(sub_issues, order_by_param)

        sub_issues = list(
            sub_issues.values(
                "id",
                "name",
                "state_id",
                "sort_order",
                "completed_at",
                "estimate_point",
                "priority",
                "start_date",
                "target_date",
                "sequence_id",
                "project_id",
                "parent_id",
                "cycle_id",
                "module_ids",
                "label_ids",
                "assignee_ids",
                "sub_issues_count",
                "created_at",
                "updated_at",
                "created_by",
                "updated_by",
                "attachment_count",
                "link_count",
                "is_draft",
                "archived_at",
                "state_group",
            )
        )

        # create's a dict with state group name with their respective issue id's
        result = defaultdict(list)
        for sub_issue in sub_issues:
            result[sub_issue["state_group"]].append(str(sub_issue["id"]))

        datetime_fields = ["created_at", "updated_at"]
        sub_issues = user_timezone_converter(sub_issues, datetime_fields, request.user.user_timezone)
        # Grouping
        if group_by:
            result_dict = defaultdict(list)

            for issue in sub_issues:
                # Assignee grouping is many-to-many: an issue appears under every
                # assignee it has, and unassigned issues go under "None".
                if group_by == "assignees__ids":
                    if issue["assignee_ids"]:
                        assignee_ids = issue["assignee_ids"]
                        for assignee_id in assignee_ids:
                            result_dict[str(assignee_id)].append(issue)
                    elif issue["assignee_ids"] == []:
                        result_dict["None"].append(issue)

                elif group_by:
                    result_dict[str(issue[group_by])].append(issue)

            return Response(
                {"sub_issues": result_dict, "state_distribution": result},
                status=status.HTTP_200_OK,
            )
        return Response(
            {"sub_issues": sub_issues, "state_distribution": result},
            status=status.HTTP_200_OK,
        )

    # Assign multiple sub issues
    def post(self, request, slug, project_id, issue_id):
        """Set ``issue_id`` as the parent of every issue in ``sub_issue_ids``.

        Bulk-updates ``Issue.parent``, queues one ``issue_activity`` task per
        sub-issue (with notifications) and returns the updated sub-issues plus
        their state-group distribution.
        """
        parent_issue = Issue.issue_objects.get(pk=issue_id)
        sub_issue_ids = request.data.get("sub_issue_ids", [])

        if not len(sub_issue_ids):
            return Response(
                {"error": "Sub Issue IDs are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Scope to workspace to prevent cross-tenant IDOR
        sub_issues = Issue.issue_objects.filter(id__in=sub_issue_ids, workspace__slug=slug)

        for sub_issue in sub_issues:
            sub_issue.parent = parent_issue

        # bulk_update skips model save() hooks/signals; activity is logged explicitly below.
        _ = Issue.objects.bulk_update(sub_issues, ["parent"], batch_size=10)

        updated_sub_issues = Issue.issue_objects.filter(id__in=sub_issue_ids).annotate(state_group=F("state__group"))

        # Track the issue
        _ = [
            issue_activity.delay(
                type="issue.activity.updated",
                requested_data=json.dumps({"parent": str(issue_id)}),
                actor_id=str(request.user.id),
                issue_id=str(sub_issue_id),
                project_id=str(project_id),
                current_instance=json.dumps({"parent": str(sub_issue_id)}),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            for sub_issue_id in sub_issue_ids
        ]

        # create's a dict with state group name with their respective issue id's
        result = defaultdict(list)
        for sub_issue in updated_sub_issues:
            result[sub_issue.state_group].append(str(sub_issue.id))

        serializer = IssueSerializer(updated_sub_issues, many=True)
        return Response(
            {"sub_issues": serializer.data, "state_distribution": result},
            status=status.HTTP_200_OK,
        )
