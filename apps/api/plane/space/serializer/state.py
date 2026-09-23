# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""State serializers for the public (space) API."""

# Module imports
from .base import BaseSerializer
from plane.db.models import State


class StateSerializer(BaseSerializer):
    """All state fields; workspace/project read-only."""

    class Meta:
        model = State
        fields = "__all__"
        read_only_fields = ["workspace", "project"]


class StateLiteSerializer(BaseSerializer):
    """Minimal read-only state info (id, name, color, group)."""

    class Meta:
        model = State
        fields = ["id", "name", "color", "group"]
        read_only_fields = fields
