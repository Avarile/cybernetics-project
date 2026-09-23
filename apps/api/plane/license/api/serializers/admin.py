# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for instance admins and the currently signed-in admin user (god-mode API)."""

# Module imports
from .base import BaseSerializer
from plane.db.models import User
from plane.app.serializers import UserAdminLiteSerializer
from plane.license.models import InstanceAdmin


class InstanceAdminMeSerializer(BaseSerializer):
    """Read-only profile of the signed-in instance admin (``/api/instances/admins/me/``)."""

    class Meta:
        model = User
        fields = [
            "id",
            "avatar",
            "avatar_url",
            "cover_image",
            "date_joined",
            "display_name",
            "email",
            "first_name",
            "last_name",
            "is_active",
            "is_bot",
            "is_email_verified",
            "user_timezone",
            "username",
            "is_password_autoset",
            "is_email_verified",
        ]
        read_only_fields = fields


class InstanceAdminSerializer(BaseSerializer):
    """InstanceAdmin rows with nested lite user details; instance and user are read-only."""

    user_detail = UserAdminLiteSerializer(source="user", read_only=True)

    class Meta:
        model = InstanceAdmin
        fields = "__all__"
        read_only_fields = ["id", "instance", "user"]
