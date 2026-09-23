# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project-level "advanced analytics" endpoints.

Serves the project analytics page: headline work item counts, per-assignee
state breakdowns and chart data (custom x-axis/group-by charts and
created-vs-completed trends), optionally narrowed to a cycle or module.
Filters (date range, project ids) are derived by ``get_analytics_filters``.
"""

from rest_framework.response import Response
from rest_framework import status
from typing import Dict, Any
from django.db.models import QuerySet, Q, Count
from django.http import HttpRequest
from django.db.models.functions import TruncMonth
from django.utils import timezone
from datetime import timedelta
from plane.app.views.base import BaseAPIView
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import (
    Project,
    Issue,
    Cycle,
    Module,
    CycleIssue,
    ModuleIssue,
)
from django.db import models
from django.db.models import F, Case, When, Value
from django.db.models.functions import Concat
from plane.utils.build_chart import build_analytics_chart
from plane.utils.date_utils import (
    get_analytics_filters,
)


class ProjectAdvanceAnalyticsBaseView(BaseAPIView):
    """Shared setup for the project analytics endpoints."""

    def initialize_workspace(self, slug: str, type: str) -> None:
        """Store the workspace slug and compute ``self.filters`` from the request.

        ``type`` ("analytics" or "chart") controls which date ranges are produced
        (``analytics_date_range`` vs ``chart_period_range``).
        """
        self._workspace_slug = slug
        self.filters = get_analytics_filters(
            slug=slug,
            type=type,
            user=self.request.user,
            date_filter=self.request.GET.get("date_filter", None),
            project_ids=self.request.GET.get("project_ids", None),
        )


class ProjectAdvanceAnalyticsEndpoint(ProjectAdvanceAnalyticsBaseView):
    """Headline work item counts per state group for a project, cycle or module."""

    def get_filtered_counts(self, queryset: QuerySet) -> Dict[str, int]:
        """Return ``{"count": n}`` for the queryset, limited to the current date range if one is set."""
        def get_filtered_count() -> int:
            if self.filters["analytics_date_range"]:
                return queryset.filter(
                    created_at__gte=self.filters["analytics_date_range"]["current"]["gte"],
                    created_at__lte=self.filters["analytics_date_range"]["current"]["lte"],
                ).count()
            return queryset.count()

        return {
            "count": get_filtered_count(),
        }

    def get_work_items_stats(self, project_id, cycle_id=None, module_id=None) -> Dict[str, Dict[str, int]]:
        """
        Returns work item stats for the workspace, or filtered by cycle_id or module_id if provided.
        """
        base_queryset = None
        if cycle_id is not None:
            cycle_issues = CycleIssue.objects.filter(**self.filters["base_filters"], cycle_id=cycle_id).values_list(
                "issue_id", flat=True
            )
            base_queryset = Issue.issue_objects.filter(id__in=cycle_issues)
        elif module_id is not None:
            module_issues = ModuleIssue.objects.filter(**self.filters["base_filters"], module_id=module_id).values_list(
                "issue_id", flat=True
            )
            base_queryset = Issue.issue_objects.filter(id__in=module_issues)
        else:
            base_queryset = Issue.issue_objects.filter(**self.filters["base_filters"], project_id=project_id)

        return {
            "total_work_items": self.get_filtered_counts(base_queryset),
            "started_work_items": self.get_filtered_counts(base_queryset.filter(state__group="started")),
            "backlog_work_items": self.get_filtered_counts(base_queryset.filter(state__group="backlog")),
            "un_started_work_items": self.get_filtered_counts(base_queryset.filter(state__group="unstarted")),
            "completed_work_items": self.get_filtered_counts(base_queryset.filter(state__group="completed")),
        }

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request: HttpRequest, slug: str, project_id: str) -> Response:
        """Return work item stats; ``cycle_id`` / ``module_id`` query params narrow the scope."""
        self.initialize_workspace(slug, type="analytics")

        # Optionally accept cycle_id or module_id as query params
        cycle_id = request.GET.get("cycle_id", None)
        module_id = request.GET.get("module_id", None)
        return Response(
            self.get_work_items_stats(cycle_id=cycle_id, module_id=module_id, project_id=project_id),
            status=status.HTTP_200_OK,
        )


class ProjectAdvanceAnalyticsStatsEndpoint(ProjectAdvanceAnalyticsBaseView):
    """Per-assignee work item breakdowns for a project."""

    def get_project_issues_stats(self) -> QuerySet:
        """Return per-project work item counts by state group (within the chart period, if any).

        Not used by ``get`` in this view.
        """
        # Get the base queryset with workspace and project filters
        base_queryset = Issue.issue_objects.filter(**self.filters["base_filters"])

        # Apply date range filter if available
        if self.filters["chart_period_range"]:
            start_date, end_date = self.filters["chart_period_range"]
            base_queryset = base_queryset.filter(created_at__date__gte=start_date, created_at__date__lte=end_date)

        return (
            base_queryset.values("project_id", "project__name")
            .annotate(
                cancelled_work_items=Count("id", filter=Q(state__group="cancelled")),
                completed_work_items=Count("id", filter=Q(state__group="completed")),
                backlog_work_items=Count("id", filter=Q(state__group="backlog")),
                un_started_work_items=Count("id", filter=Q(state__group="unstarted")),
                started_work_items=Count("id", filter=Q(state__group="started")),
            )
            .order_by("project_id")
        )

    def get_work_items_stats(self, project_id, cycle_id=None, module_id=None) -> Dict[str, Dict[str, int]]:
        """Return per-assignee counts by state group, scoped to a project, cycle or module."""
        base_queryset = None
        if cycle_id is not None:
            cycle_issues = CycleIssue.objects.filter(**self.filters["base_filters"], cycle_id=cycle_id).values_list(
                "issue_id", flat=True
            )
            base_queryset = Issue.issue_objects.filter(id__in=cycle_issues)
        elif module_id is not None:
            module_issues = ModuleIssue.objects.filter(**self.filters["base_filters"], module_id=module_id).values_list(
                "issue_id", flat=True
            )
            base_queryset = Issue.issue_objects.filter(id__in=module_issues)
        else:
            base_queryset = Issue.issue_objects.filter(**self.filters["base_filters"], project_id=project_id)
        return (
            # One row per assignee (unassigned items group under a null assignee); distinct
            # counts avoid double counting caused by the assignee join.
            base_queryset.annotate(display_name=F("assignees__display_name"))
            .annotate(assignee_id=F("assignees__id"))
            .annotate(avatar=F("assignees__avatar"))
            .annotate(
                avatar_url=Case(
                    # If `avatar_asset` exists, use it to generate the asset URL
                    When(
                        assignees__avatar_asset__isnull=False,
                        then=Concat(
                            Value("/api/assets/v2/static/"),
                            "assignees__avatar_asset",  # Assuming avatar_asset has an id or relevant field
                            Value("/"),
                        ),
                    ),
                    # If `avatar_asset` is None, fall back to using `avatar` field directly
                    When(assignees__avatar_asset__isnull=True, then="assignees__avatar"),
                    default=Value(None),
                    output_field=models.CharField(),
                )
            )
            .values("display_name", "assignee_id", "avatar_url")
            .annotate(
                cancelled_work_items=Count("id", filter=Q(state__group="cancelled"), distinct=True),
                completed_work_items=Count("id", filter=Q(state__group="completed"), distinct=True),
                backlog_work_items=Count("id", filter=Q(state__group="backlog"), distinct=True),
                un_started_work_items=Count("id", filter=Q(state__group="unstarted"), distinct=True),
                started_work_items=Count("id", filter=Q(state__group="started"), distinct=True),
            )
            .order_by("display_name")
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request: HttpRequest, slug: str, project_id: str) -> Response:
        """Return assignee stats for ``type=work-items``; other types are rejected with 400."""
        self.initialize_workspace(slug, type="chart")
        type = request.GET.get("type", "work-items")

        if type == "work-items":
            # Optionally accept cycle_id or module_id as query params
            cycle_id = request.GET.get("cycle_id", None)
            module_id = request.GET.get("module_id", None)
            return Response(
                self.get_work_items_stats(project_id=project_id, cycle_id=cycle_id, module_id=module_id),
                status=status.HTTP_200_OK,
            )

        return Response({"message": "Invalid type"}, status=status.HTTP_400_BAD_REQUEST)


class ProjectAdvanceAnalyticsChartEndpoint(ProjectAdvanceAnalyticsBaseView):
    """Chart data for the project analytics page."""

    def work_item_completion_chart(self, project_id, cycle_id=None, module_id=None) -> Dict[str, Any]:
        """Build the created-vs-completed trend chart.

        For a cycle/module: one point per day between its start and end dates.
        For the whole project: one point per month from the project's creation month
        to the current month. Returns ``{"data": [...], "schema": {...}}``.
        """
        # Get the base queryset
        queryset = (
            Issue.issue_objects.filter(**self.filters["base_filters"])
            .filter(project_id=project_id)
            .select_related("workspace", "state", "parent")
            .prefetch_related("assignees", "labels", "issue_module__module", "issue_cycle__cycle")
        )

        if cycle_id is not None:
            cycle_issues = CycleIssue.objects.filter(**self.filters["base_filters"], cycle_id=cycle_id).values_list(
                "issue_id", flat=True
            )
            cycle = Cycle.objects.filter(id=cycle_id).first()
            if cycle and cycle.start_date:
                start_date = cycle.start_date.date()
                end_date = cycle.end_date.date()
            else:
                return {"data": [], "schema": {}}
            # Note: queryset now holds CycleIssue rows (issue ids), so the daily stats below
            # are keyed on when the issue was added to the cycle.
            queryset = cycle_issues

        elif module_id is not None:
            module_issues = ModuleIssue.objects.filter(**self.filters["base_filters"], module_id=module_id).values_list(
                "issue_id", flat=True
            )
            module = Module.objects.filter(id=module_id).first()
            if module and module.start_date:
                start_date = module.start_date
                end_date = module.target_date
            else:
                return {"data": [], "schema": {}}
            # Same as above, but with ModuleIssue rows.
            queryset = module_issues

        else:
            project = Project.objects.filter(id=project_id).first()
            if project.created_at:
                start_date = project.created_at.date().replace(day=1)
            else:
                return {"data": [], "schema": {}}

        if cycle_id or module_id:
            # Get daily stats with optimized query
            daily_stats = (
                queryset.values("created_at__date")
                .annotate(
                    created_count=Count("id"),
                    completed_count=Count("id", filter=Q(issue__state__group="completed")),
                )
                .order_by("created_at__date")
            )

            # Create a dictionary of existing stats with summed counts
            stats_dict = {
                stat["created_at__date"].strftime("%Y-%m-%d"): {
                    "created_count": stat["created_count"],
                    "completed_count": stat["completed_count"],
                }
                for stat in daily_stats
            }

            # Generate data for all days in the range
            data = []
            current_date = start_date
            while current_date <= end_date:
                date_str = current_date.strftime("%Y-%m-%d")
                stats = stats_dict.get(date_str, {"created_count": 0, "completed_count": 0})
                data.append(
                    {
                        "key": date_str,
                        "name": date_str,
                        "count": stats["created_count"] + stats["completed_count"],
                        "completed_issues": stats["completed_count"],
                        "created_issues": stats["created_count"],
                    }
                )
                current_date += timedelta(days=1)
        else:
            # Apply date range filter if available
            if self.filters["chart_period_range"]:
                start_date, end_date = self.filters["chart_period_range"]
                queryset = queryset.filter(created_at__date__gte=start_date, created_at__date__lte=end_date)

            # Annotate by month and count
            monthly_stats = (
                queryset.annotate(month=TruncMonth("created_at"))
                .values("month")
                .annotate(
                    created_count=Count("id"),
                    completed_count=Count("id", filter=Q(state__group="completed")),
                )
                .order_by("month")
            )

            # Create dictionary of month -> counts
            stats_dict = {
                stat["month"].strftime("%Y-%m-%d"): {
                    "created_count": stat["created_count"],
                    "completed_count": stat["completed_count"],
                }
                for stat in monthly_stats
            }

            # Generate monthly data (ensure months with 0 count are included)
            data = []
            # include the current date at the end
            end_date = timezone.now().date()
            last_month = end_date.replace(day=1)
            current_month = start_date

            while current_month <= last_month:
                date_str = current_month.strftime("%Y-%m-%d")
                stats = stats_dict.get(date_str, {"created_count": 0, "completed_count": 0})
                data.append(
                    {
                        "key": date_str,
                        "name": date_str,
                        "count": stats["created_count"],
                        "completed_issues": stats["completed_count"],
                        "created_issues": stats["created_count"],
                    }
                )
                # Move to next month
                if current_month.month == 12:
                    current_month = current_month.replace(year=current_month.year + 1, month=1)
                else:
                    current_month = current_month.replace(month=current_month.month + 1)

        schema = {
            "completed_issues": "completed_issues",
            "created_issues": "created_issues",
        }

        return {"data": data, "schema": schema}

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request: HttpRequest, slug: str, project_id: str) -> Response:
        """Return chart data.

        ``type=custom-work-items`` builds a generic chart via ``build_analytics_chart``
        using ``x_axis`` / ``group_by``; ``type=work-items`` returns the completion
        trend chart. Other types get a 400.
        """
        self.initialize_workspace(slug, type="chart")
        type = request.GET.get("type", "projects")
        group_by = request.GET.get("group_by", None)
        x_axis = request.GET.get("x_axis", "PRIORITY")
        cycle_id = request.GET.get("cycle_id", None)
        module_id = request.GET.get("module_id", None)

        if type == "custom-work-items":
            queryset = (
                Issue.issue_objects.filter(**self.filters["base_filters"])
                .filter(project_id=project_id)
                .select_related("workspace", "state", "parent")
                .prefetch_related("assignees", "labels", "issue_module__module", "issue_cycle__cycle")
            )

            # Apply cycle/module filters if present
            if cycle_id is not None:
                cycle_issues = CycleIssue.objects.filter(**self.filters["base_filters"], cycle_id=cycle_id).values_list(
                    "issue_id", flat=True
                )
                queryset = queryset.filter(id__in=cycle_issues)

            elif module_id is not None:
                module_issues = ModuleIssue.objects.filter(
                    **self.filters["base_filters"], module_id=module_id
                ).values_list("issue_id", flat=True)
                queryset = queryset.filter(id__in=module_issues)

            # Apply date range filter if available
            if self.filters["chart_period_range"]:
                start_date, end_date = self.filters["chart_period_range"]
                queryset = queryset.filter(created_at__date__gte=start_date, created_at__date__lte=end_date)

            return Response(
                build_analytics_chart(queryset, x_axis, group_by),
                status=status.HTTP_200_OK,
            )

        elif type == "work-items":
            # Optionally accept cycle_id or module_id as query params
            cycle_id = request.GET.get("cycle_id", None)
            module_id = request.GET.get("module_id", None)

            return Response(
                self.work_item_completion_chart(project_id=project_id, cycle_id=cycle_id, module_id=module_id),
                status=status.HTTP_200_OK,
            )

        return Response({"message": "Invalid type"}, status=status.HTTP_400_BAD_REQUEST)
