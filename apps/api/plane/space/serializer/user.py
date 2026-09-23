# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""User serializer for the public (space) API; exposes only non-sensitive profile fields."""

# Module imports
from .base import BaseSerializer
from plane.db.models import User


class UserLiteSerializer(BaseSerializer):
    """Public profile fields of a user (names, avatar, display name); no email."""

    class Meta:
        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "avatar",
            "avatar_url",
            "is_bot",
            "display_name",
        ]
        read_only_fields = ["id", "is_bot"]
