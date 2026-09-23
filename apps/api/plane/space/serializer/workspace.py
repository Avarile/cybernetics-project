# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace serializer for the public (space) API."""

# Module imports
from .base import BaseSerializer
from plane.db.models import Workspace


class WorkspaceLiteSerializer(BaseSerializer):
    """Read-only workspace name, slug and id."""

    class Meta:
        model = Workspace
        fields = ["name", "slug", "id"]
        read_only_fields = fields
