# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Queryset helpers for grouped issue listings on published (space) boards.

Used by the public project issues endpoint together with the grouped/sub-grouped
paginators: annotate issues with id arrays, project them to the fields the board needs,
and list the possible group values for a given ``group_by`` field.
"""

# Django imports
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models import Q, UUIDField, Value, F, Case, When, JSONField, CharField
from django.db.models.functions import Coalesce, JSONObject, Concat
from django.db.models import QuerySet

from typing import List, Optional, Dict, Any, Union

# Module imports
from plane.db.models import (
    Cycle,
    Issue,
    Label,
    Module,
    Project,
    ProjectMember,
    State,
    WorkspaceMember,
)


def issue_queryset_grouper(
    queryset: QuerySet[Issue], group_by: Optional[str], sub_group_by: Optional[str]
) -> QuerySet[Issue]:
    """Annotate issues with ``assignee_ids``, ``label_ids`` and ``module_ids`` UUID arrays.

    When grouping by a many-to-many field, soft-deleted relation rows are filtered out first
    so an issue is not placed in a group it was removed from.
    """
    FIELD_MAPPER = {
        "label_ids": "labels__id",
        "assignee_ids": "assignees__id",
        "module_ids": "issue_module__module_id",
    }

    GROUP_FILTER_MAPPER = {
        "assignees__id": Q(issue_assignee__deleted_at__isnull=True),
        "labels__id": Q(label_issue__deleted_at__isnull=True),
        "issue_module__module_id": Q(issue_module__deleted_at__isnull=True),
    }

    for group_key in [group_by, sub_group_by]:
        if group_key in GROUP_FILTER_MAPPER:
            queryset = queryset.filter(GROUP_FILTER_MAPPER[group_key])

    annotations_map = {
        "assignee_ids": (
            "assignees__id",
            ~Q(assignees__id__isnull=True) & Q(issue_assignee__deleted_at__isnull=True),
        ),
        "label_ids": (
            "labels__id",
            ~Q(labels__id__isnull=True) & Q(label_issue__deleted_at__isnull=True),
        ),
        "module_ids": (
            "issue_module__module_id",
            ~Q(issue_module__module_id__isnull=True),
        ),
    }
    # ArrayAgg over active relation rows, defaulting to [] when there are none.
    # Note: the ``or`` condition only skips a key when it matches both group_by and sub_group_by.
    default_annotations = {
        key: Coalesce(
            ArrayAgg(field, distinct=True, filter=condition),
            Value([], output_field=ArrayField(UUIDField())),
        )
        for key, (field, condition) in annotations_map.items()
        if FIELD_MAPPER.get(key) != group_by or FIELD_MAPPER.get(key) != sub_group_by
    }

    return queryset.annotate(**default_annotations)


def issue_on_results(
    issues: QuerySet[Issue], group_by: Optional[str], sub_group_by: Optional[str]
) -> List[Dict[str, Any]]:
    """Project issues to the fields rendered on the board (as ``.values()`` dicts).

    Adds ``vote_items`` and ``reaction_items`` JSON arrays (with actor details). When grouping
    by a many-to-many field, the raw join column (e.g. ``labels__id``) is selected instead of
    the corresponding ``*_ids`` array.
    """
    FIELD_MAPPER = {
        "labels__id": "label_ids",
        "assignees__id": "assignee_ids",
        "issue_module__module_id": "module_ids",
    }

    original_list = ["assignee_ids", "label_ids", "module_ids"]

    required_fields = [
        "id",
        "name",
        "state_id",
        "sort_order",
        "estimate_point",
        "priority",
        "start_date",
        "target_date",
        "sequence_id",
        "project_id",
        "parent_id",
        "cycle_id",
        "created_by",
        "state__group",
    ]

    if group_by in FIELD_MAPPER:
        original_list.remove(FIELD_MAPPER[group_by])
        original_list.append(group_by)

    if sub_group_by in FIELD_MAPPER:
        original_list.remove(FIELD_MAPPER[sub_group_by])
        original_list.append(sub_group_by)

    required_fields.extend(original_list)

    issues = issues.annotate(
        vote_items=ArrayAgg(
            Case(
                When(
                    votes__isnull=False,
                    votes__deleted_at__isnull=True,
                    then=JSONObject(
                        vote=F("votes__vote"),
                        actor_details=JSONObject(
                            id=F("votes__actor__id"),
                            first_name=F("votes__actor__first_name"),
                            last_name=F("votes__actor__last_name"),
                            avatar=F("votes__actor__avatar"),
                            # Uploaded avatars are served via the static asset endpoint; fall back to the legacy avatar URL.
                            avatar_url=Case(
                                When(
                                    votes__actor__avatar_asset__isnull=False,
                                    then=Concat(
                                        Value("/api/assets/v2/static/"),
                                        F("votes__actor__avatar_asset"),
                                        Value("/"),
                                    ),
                                ),
                                default=F("votes__actor__avatar"),
                                output_field=CharField(),
                            ),
                            display_name=F("votes__actor__display_name"),
                        ),
                    ),
                ),
                default=None,
                output_field=JSONField(),
            ),
            filter=Q(votes__isnull=False, votes__deleted_at__isnull=True),
            distinct=True,
        ),
        reaction_items=ArrayAgg(
            Case(
                When(
                    issue_reactions__isnull=False,
                    issue_reactions__deleted_at__isnull=True,
                    then=JSONObject(
                        reaction=F("issue_reactions__reaction"),
                        actor_details=JSONObject(
                            id=F("issue_reactions__actor__id"),
                            first_name=F("issue_reactions__actor__first_name"),
                            last_name=F("issue_reactions__actor__last_name"),
                            avatar=F("issue_reactions__actor__avatar"),
                            avatar_url=Case(
                                When(
                                    issue_reactions__actor__avatar_asset__isnull=False,
                                    then=Concat(
                                        Value("/api/assets/v2/static/"),
                                        F("issue_reactions__actor__avatar_asset"),
                                        Value("/"),
                                    ),
                                ),
                                default=F("issue_reactions__actor__avatar"),
                                output_field=CharField(),
                            ),
                            display_name=F("issue_reactions__actor__display_name"),
                        ),
                    ),
                ),
                default=None,
                output_field=JSONField(),
            ),
            filter=Q(issue_reactions__isnull=False, issue_reactions__deleted_at__isnull=True),
            distinct=True,
        ),
    ).values(*required_fields, "vote_items", "reaction_items")

    return issues


def issue_group_values(
    field: str,
    slug: str,
    project_id: Optional[str] = None,
    filters: Dict[str, Any] = {},
    queryset: Optional[QuerySet] = None,
) -> List[Union[str, Any]]:
    """Return every possible value of ``field`` in the workspace (optionally a single project),
    used to emit empty groups too.

    Nullable relations include a ``"None"`` group. Date and ``created_by`` groups are taken
    from the given ``queryset``; unknown fields yield [].
    """
    if field == "state_id":
        queryset = State.objects.filter(is_triage=False, workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)
    if field == "labels__id":
        queryset = Label.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        else:
            return list(queryset) + ["None"]
    if field == "assignees__id":
        if project_id:
            return ProjectMember.objects.filter(
                workspace__slug=slug, project_id=project_id, is_active=True
            ).values_list("member_id", flat=True)
        else:
            return list(
                WorkspaceMember.objects.filter(workspace__slug=slug, is_active=True).values_list("member_id", flat=True)
            )
    if field == "issue_module__module_id":
        queryset = Module.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        else:
            return list(queryset) + ["None"]
    if field == "cycle_id":
        queryset = Cycle.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        else:
            return list(queryset) + ["None"]
    if field == "project_id":
        queryset = Project.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        return list(queryset)
    if field == "priority":
        return ["low", "medium", "high", "urgent", "none"]
    if field == "state__group":
        return ["backlog", "unstarted", "started", "completed", "cancelled"]
    if field == "target_date":
        queryset = queryset.values_list("target_date", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)
    if field == "start_date":
        queryset = queryset.values_list("start_date", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)

    if field == "created_by":
        queryset = queryset.values_list("created_by", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)

    return []
