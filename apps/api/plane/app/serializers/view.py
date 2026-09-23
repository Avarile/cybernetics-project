# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for saved issue views (``IssueView``) and the lightweight issue list used by views."""

# Third party imports
from rest_framework import serializers

# Module imports
from .base import DynamicBaseSerializer
from plane.db.models import IssueView
from plane.utils.issue_filters import issue_filters


class ViewIssueListSerializer(serializers.Serializer):
    """Hand-written read serializer for issues listed in a view.

    Relies on prefetched ``issue_assignee``/``label_issue``/``issue_module`` and on
    annotated ``cycle_id``, ``sub_issues_count``, ``attachment_count`` and ``link_count``.
    """

    def get_assignee_ids(self, instance):
        """Assignee ids from the prefetched ``issue_assignee`` relation."""
        return [assignee.assignee_id for assignee in instance.issue_assignee.all()]

    def get_label_ids(self, instance):
        """Label ids from the prefetched ``label_issue`` relation."""
        return [label.label_id for label in instance.label_issue.all()]

    def get_module_ids(self, instance):
        """Module ids from the prefetched ``issue_module`` relation."""
        return [module.module_id for module in instance.issue_module.all()]

    def to_representation(self, instance):
        """Build the issue dict directly from model attributes."""
        data = {
            "id": instance.id,
            "name": instance.name,
            "state_id": instance.state_id,
            "sort_order": instance.sort_order,
            "completed_at": instance.completed_at,
            "estimate_point": instance.estimate_point_id,
            "priority": instance.priority,
            "start_date": instance.start_date,
            "target_date": instance.target_date,
            "sequence_id": instance.sequence_id,
            "project_id": instance.project_id,
            "parent_id": instance.parent_id,
            "cycle_id": instance.cycle_id,
            "sub_issues_count": instance.sub_issues_count,
            "created_at": instance.created_at,
            "updated_at": instance.updated_at,
            "created_by": instance.created_by_id,
            "updated_by": instance.updated_by_id,
            "attachment_count": instance.attachment_count,
            "link_count": instance.link_count,
            "is_draft": instance.is_draft,
            "archived_at": instance.archived_at,
            "state__group": instance.state.group if instance.state else None,
            "assignee_ids": self.get_assignee_ids(instance),
            "label_ids": self.get_label_ids(instance),
            "module_ids": self.get_module_ids(instance),
        }
        return data


class IssueViewSerializer(DynamicBaseSerializer):
    """Saved issue view; the stored ``query`` is derived server-side from ``filters``."""

    is_favorite = serializers.BooleanField(read_only=True)

    class Meta:
        model = IssueView
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "query",
            "owned_by",
            "access",
            "is_locked",
        ]

    def create(self, validated_data):
        """Create the view, converting ``filters`` into an issue filter ``query``."""
        query_params = validated_data.get("filters", {})
        if bool(query_params):
            validated_data["query"] = issue_filters(query_params, "POST")
        else:
            validated_data["query"] = {}
        return IssueView.objects.create(**validated_data)

    def update(self, instance, validated_data):
        """Update the view and recompute ``query`` from ``filters``."""
        # NOTE: the final assignment below overwrites the if/else result using PATCH semantics
        query_params = validated_data.get("filters", {})
        if bool(query_params):
            validated_data["query"] = issue_filters(query_params, "POST")
        else:
            validated_data["query"] = {}
        validated_data["query"] = issue_filters(query_params, "PATCH")
        return super().update(instance, validated_data)
