# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for project estimates and their estimate points (public API)."""

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import Estimate, EstimatePoint
from .base import BaseSerializer


class EstimateSerializer(BaseSerializer):
    """Serializer for an Estimate; workspace/project are injected from context on create."""
    class Meta:
        model = Estimate
        fields = "__all__"
        read_only_fields = ["workspace", "project", "deleted_at"]

    def create(self, validated_data):
        """Create the estimate bound to the workspace and project from serializer context."""
        validated_data["workspace"] = self.context["workspace"]
        validated_data["project"] = self.context["project"]
        return super().create(validated_data)


class EstimatePointSerializer(BaseSerializer):
    """Serializer for a single EstimatePoint (value limited to 20 characters)."""
    def validate(self, data):
        """Reject empty payloads and values longer than 20 characters."""
        if not data:
            raise serializers.ValidationError("Estimate points are required")
        value = data.get("value")
        if value and len(value) > 20:
            raise serializers.ValidationError("Value can't be more than 20 characters")
        return data

    class Meta:
        model = EstimatePoint
        fields = "__all__"
        read_only_fields = ["estimate", "workspace", "project"]
