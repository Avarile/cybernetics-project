# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializer for saved analytics views (``AnalyticView``) used by the analytics endpoints."""

from .base import BaseSerializer
from plane.db.models import AnalyticView
from plane.utils.issue_filters import issue_filters


class AnalyticViewSerializer(BaseSerializer):
    """Saved analytics view; ``query`` is derived server-side from the submitted filter params."""

    class Meta:
        model = AnalyticView
        fields = "__all__"
        read_only_fields = ["workspace", "query"]

    def create(self, validated_data):
        """Create the view, converting ``query_dict`` filter params into an issue filter ``query``."""
        query_params = validated_data.get("query_dict", {})
        if bool(query_params):
            validated_data["query"] = issue_filters(query_params, "POST")
        else:
            validated_data["query"] = {}
        return AnalyticView.objects.create(**validated_data)

    def update(self, instance, validated_data):
        """Update the view and recompute ``query`` from the filter params."""
        # NOTE: reads "query_data" (not "query_dict" as in create), and the final assignment below
        # overwrites the if/else result using PATCH semantics.
        query_params = validated_data.get("query_data", {})
        if bool(query_params):
            validated_data["query"] = issue_filters(query_params, "POST")
        else:
            validated_data["query"] = {}
        validated_data["query"] = issue_filters(query_params, "PATCH")
        return super().update(instance, validated_data)
