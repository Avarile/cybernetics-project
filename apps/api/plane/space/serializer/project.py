# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project serializer for the public (space) API."""

# Module imports
from .base import BaseSerializer
from plane.db.models import Project


class ProjectLiteSerializer(BaseSerializer):
    """Read-only public-facing project details (name, identifier, cover, icon)."""

    class Meta:
        model = Project
        fields = [
            "id",
            "identifier",
            "name",
            "cover_image",
            "icon_prop",
            "emoji",
            "description",
        ]
        read_only_fields = fields
