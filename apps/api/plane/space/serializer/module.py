# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Module serializer for the public (space) API."""

# Module imports
from .base import BaseSerializer
from plane.db.models import Module


class ModuleBaseSerializer(BaseSerializer):
    """All module fields; ownership/audit fields read-only."""

    class Meta:
        model = Module
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]
