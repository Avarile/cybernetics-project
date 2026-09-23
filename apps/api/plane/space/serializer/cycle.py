# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Cycle serializer for the public (space) API."""

# Module imports
from .base import BaseSerializer
from plane.db.models import Cycle


class CycleBaseSerializer(BaseSerializer):
    """All cycle fields; ownership/audit fields read-only."""

    class Meta:
        model = Cycle
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]
