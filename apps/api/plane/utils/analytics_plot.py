# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Query helpers that build analytics and burndown chart data from Issue querysets.

build_graph_plot powers the analytics views (issue count or estimate sum grouped by an
x-axis field and optional segment); burndown_plot computes the day-by-day remaining work
for a cycle or module.
"""

# Python imports
from datetime import timedelta
from itertools import groupby

# Django import
from django.db import models
from django.db.models import Case, CharField, Count, F, Sum, Value, When, FloatField
from django.db.models.functions import (
    Coalesce,
    Concat,
    ExtractMonth,
    ExtractYear,
    TruncDate,
    Cast,
)
from django.utils import timezone

# Module imports
from plane.db.models import Issue, Project

# Whitelist of Issue lookups allowed as x-axis or segment (guards against arbitrary field access).
VALID_ANALYTICS_FIELDS = [
    "state_id",
    "state__group",
    "labels__id",
    "assignees__id",
    "estimate_point__value",
    "issue_cycle__cycle_id",
    "issue_module__module_id",
    "priority",
    "start_date",
    "target_date",
    "created_at",
    "completed_at",
]

# Supported metrics: number of issues, or sum of estimate point values.
VALID_YAXIS = ["issue_count", "estimate"]


def annotate_with_monthly_dimension(queryset, field_name, attribute):
    """Annotate `attribute` with a "YYYY-M" string built from the date field `field_name`."""
    # Get the year and the months
    year = ExtractYear(field_name)
    month = ExtractMonth(field_name)
    # Concat the year and month
    dimension = Concat(year, Value("-"), month, output_field=CharField())
    # Annotate the dimension
    return queryset.annotate(**{attribute: dimension})


def extract_axis(queryset, x_axis):
    """Annotate the queryset with a `dimension` column for the given x-axis.

    Date fields are bucketed by year-month; other fields are copied as-is.
    Returns (queryset, "dimension"). Raises ValueError for non-whitelisted fields.
    """
    if x_axis not in VALID_ANALYTICS_FIELDS:
        raise ValueError(f"Invalid x_axis value: {x_axis}")
    # Format the dimension when the axis is in date
    if x_axis in ["created_at", "start_date", "target_date", "completed_at"]:
        queryset = annotate_with_monthly_dimension(queryset, x_axis, "dimension")
        return queryset, "dimension"
    else:
        return queryset.annotate(dimension=F(x_axis)), "dimension"


def sort_data(data, temp_axis):
    """Order grouped chart data: fixed low->urgent order for priority, else by key with "none" last."""
    # When the axis is in priority order by
    if temp_axis == "priority":
        order = ["low", "medium", "high", "urgent", "none"]
        return {key: data[key] for key in order if key in data}
    else:
        return dict(sorted(data.items(), key=lambda x: (x[0] == "none", x[0])))


def build_graph_plot(queryset, x_axis, y_axis, segment=None):
    """Return analytics data grouped by x-axis value, optionally split by a segment field.

    Result is {dimension: [row, ...]} where each row holds the dimension, optional segment and
    either `count` (y_axis="issue_count") or `estimate` (y_axis="estimate").
    Raises ValueError for invalid axis/segment names.
    """
    if x_axis not in VALID_ANALYTICS_FIELDS:
        raise ValueError(f"Invalid x_axis value: {x_axis}")
    if y_axis not in VALID_YAXIS:
        raise ValueError(f"Invalid y_axis value: {y_axis}")
    if segment and segment not in VALID_ANALYTICS_FIELDS:
        raise ValueError(f"Invalid segment value: {segment}")

    # temp x_axis
    temp_axis = x_axis
    # Extract the x_axis and queryset
    queryset, x_axis = extract_axis(queryset, x_axis)
    if x_axis == "dimension":
        queryset = queryset.exclude(dimension__isnull=True)

    # Date segments are bucketed by year-month, like date x-axes.
    if segment in ["created_at", "start_date", "target_date", "completed_at"]:
        queryset = annotate_with_monthly_dimension(queryset, segment, "segmented")
        segment = "segmented"

    queryset = queryset.values(x_axis)

    # Issue count
    if y_axis == "issue_count":
        # NOTE: is_null / dimension_ex are dropped by the chained .values("dimension") below.
        queryset = queryset.annotate(
            is_null=Case(
                When(dimension__isnull=True, then=Value("None")),
                default=Value("not_null"),
                output_field=models.CharField(max_length=8),
            ),
            dimension_ex=Coalesce("dimension", Value("null")),
        ).values("dimension")
        queryset = queryset.annotate(segment=F(segment)) if segment else queryset
        queryset = queryset.values("dimension", "segment") if segment else queryset.values("dimension")
        queryset = queryset.annotate(count=Count("*")).order_by("dimension")

    # Estimate
    else:
        queryset = queryset.annotate(estimate=Sum(Cast("estimate_point__value", FloatField()))).order_by(x_axis)
        queryset = queryset.annotate(segment=F(segment)) if segment else queryset
        queryset = (
            queryset.values("dimension", "segment", "estimate") if segment else queryset.values("dimension", "estimate")
        )

    # itertools.groupby only merges adjacent rows, so this relies on the order_by above.
    result_values = list(queryset)
    grouped_data = {str(key): list(items) for key, items in groupby(result_values, key=lambda x: x[str("dimension")])}

    return sort_data(grouped_data, temp_axis)


def burndown_plot(queryset, slug, project_id, plot_type, cycle_id=None, module_id=None):
    """Compute burndown chart data for a cycle (cycle_id) or module (module_id).

    `queryset` is the Cycle/Module instance (annotated with total_issues). plot_type "points"
    burns down estimate points (only when the project uses a points estimate), otherwise
    issue counts. Returns {date_str: remaining}; future dates map to None.
    """
    # Total Issues in Cycle or Module
    total_issues = queryset.total_issues
    # check whether the estimate is a point or not
    estimate_type = Project.objects.filter(
        workspace__slug=slug,
        pk=project_id,
        estimate__isnull=False,
        estimate__type="points",
    ).exists()
    if estimate_type and plot_type == "points" and cycle_id:
        issue_estimates = Issue.issue_objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            issue_cycle__cycle_id=cycle_id,
            issue_cycle__deleted_at__isnull=True,
            estimate_point__isnull=False,
        ).values_list("estimate_point__value", flat=True)

        issue_estimates = [float(value) for value in issue_estimates]
        total_estimate_points = sum(issue_estimates)

    if estimate_type and plot_type == "points" and module_id:
        issue_estimates = Issue.issue_objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            issue_module__module_id=module_id,
            issue_module__deleted_at__isnull=True,
            estimate_point__isnull=False,
        ).values_list("estimate_point__value", flat=True)

        issue_estimates = [float(value) for value in issue_estimates]
        total_estimate_points = sum(issue_estimates)

    if cycle_id:
        if queryset.end_date and queryset.start_date:
            # Get all dates between the two dates
            date_range = [
                (queryset.start_date + timedelta(days=x)).date()
                for x in range((queryset.end_date.date() - queryset.start_date.date()).days + 1)
            ]
        else:
            date_range = []

        # Seed every day in the range with 0 so days without completions still appear.
        chart_data = {str(date): 0 for date in date_range}

        if plot_type == "points":
            completed_issues_estimate_point_distribution = (
                Issue.issue_objects.filter(
                    workspace__slug=slug,
                    project_id=project_id,
                    issue_cycle__cycle_id=cycle_id,
                    issue_cycle__deleted_at__isnull=True,
                    estimate_point__isnull=False,
                )
                .annotate(date=TruncDate("completed_at"))
                .values("date")
                .values("date", "estimate_point__value")
                .order_by("date")
            )
        else:
            completed_issues_distribution = (
                Issue.issue_objects.filter(
                    workspace__slug=slug,
                    project_id=project_id,
                    issue_cycle__cycle_id=cycle_id,
                    issue_cycle__deleted_at__isnull=True,
                )
                .annotate(date=TruncDate("completed_at"))
                .values("date")
                .annotate(total_completed=Count("id"))
                .values("date", "total_completed")
                .order_by("date")
            )

    if module_id:
        # Get all dates between the two dates
        date_range = [
            (queryset.start_date + timedelta(days=x))
            for x in range((queryset.target_date - queryset.start_date).days + 1)
        ]

        chart_data = {str(date): 0 for date in date_range}

        if plot_type == "points":
            completed_issues_estimate_point_distribution = (
                Issue.issue_objects.filter(
                    workspace__slug=slug,
                    project_id=project_id,
                    issue_module__module_id=module_id,
                    issue_module__deleted_at__isnull=True,
                    estimate_point__isnull=False,
                )
                .annotate(date=TruncDate("completed_at"))
                .values("date")
                .values("date", "estimate_point__value")
                .order_by("date")
            )
        else:
            completed_issues_distribution = (
                Issue.issue_objects.filter(
                    workspace__slug=slug,
                    project_id=project_id,
                    issue_module__module_id=module_id,
                    issue_module__deleted_at__isnull=True,
                )
                .annotate(date=TruncDate("completed_at"))
                .values("date")
                .annotate(total_completed=Count("id"))
                .values("date", "total_completed")
                .order_by("date")
            )

    # Remaining work for each day = total minus everything completed on or before that day.
    if plot_type == "points":
        for date in date_range:
            # NOTE: total_estimate_points is only set when the project uses a points estimate.
            cumulative_pending_issues = total_estimate_points
            total_completed = 0
            total_completed = sum(
                float(item["estimate_point__value"])
                for item in completed_issues_estimate_point_distribution
                if item["date"] is not None and item["date"] <= date
            )
            cumulative_pending_issues -= total_completed
            if date > timezone.now().date():
                chart_data[str(date)] = None
            else:
                chart_data[str(date)] = cumulative_pending_issues
    else:
        for date in date_range:
            cumulative_pending_issues = total_issues
            total_completed = 0
            total_completed = sum(
                item["total_completed"]
                for item in completed_issues_distribution
                if item["date"] is not None and item["date"] <= date
            )
            cumulative_pending_issues -= total_completed
            if date > timezone.now().date():
                chart_data[str(date)] = None
            else:
                chart_data[str(date)] = cumulative_pending_issues

    return chart_data
