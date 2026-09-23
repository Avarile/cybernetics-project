# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializer for the singleton Instance model (instance metadata shown in god mode)."""

# Module imports
from plane.license.models import Instance
from plane.app.serializers import BaseSerializer
from plane.app.serializers import UserAdminLiteSerializer


class InstanceSerializer(BaseSerializer):
    """Instance details plus the primary owner's lite user info; setup/registration fields are read-only."""

    primary_owner_details = UserAdminLiteSerializer(source="primary_owner", read_only=True)

    class Meta:
        model = Instance
        fields = "__all__"
        read_only_fields = ["id", "email", "last_checked_at", "is_setup_done"]
