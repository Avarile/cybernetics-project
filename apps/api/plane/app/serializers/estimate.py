# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for project estimates (estimate systems) and their estimate points."""

# Module imports
from .base import BaseSerializer

from plane.db.models import Estimate, EstimatePoint

from rest_framework import serializers


class EstimateSerializer(BaseSerializer):
    """Estimate system (e.g. points/categories) configured for a project."""

    class Meta:
        model = Estimate
        fields = "__all__"
        read_only_fields = ["workspace", "project"]


class EstimatePointSerializer(BaseSerializer):
    """A single estimate point value belonging to an estimate."""

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


class EstimateReadSerializer(BaseSerializer):
    """Estimate with its nested points (read-only), used for project-level reads."""

    points = EstimatePointSerializer(read_only=True, many=True)

    class Meta:
        model = Estimate
        fields = "__all__"
        read_only_fields = ["points", "name", "description"]


class WorkspaceEstimateSerializer(BaseSerializer):
    """Estimate with its nested points (read-only), used for workspace-level listings."""

    points = EstimatePointSerializer(read_only=True, many=True)

    class Meta:
        model = Estimate
        fields = "__all__"
        read_only_fields = ["points", "name", "description"]
