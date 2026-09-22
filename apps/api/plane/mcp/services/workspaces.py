# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The public API has no "my workspaces" endpoint, so this read is served directly."""

# Module imports
from plane.api.serializers import WorkspaceLiteSerializer
from plane.db.models import WorkspaceMember
from plane.mcp.services.throttle import charge_api_key_rate_limit

ROLE_NAMES = {20: "admin", 15: "member", 5: "guest"}


def list_workspaces_for_user(user_id: str, token: str) -> list[dict]:
    charge_api_key_rate_limit(token)
    memberships = (
        WorkspaceMember.objects.filter(member_id=user_id, is_active=True, workspace__deleted_at__isnull=True)
        .select_related("workspace")
        .order_by("workspace__name")
    )
    return [
        {**WorkspaceLiteSerializer(membership.workspace).data, "role": ROLE_NAMES.get(membership.role, membership.role)}
        for membership in memberships
    ]
