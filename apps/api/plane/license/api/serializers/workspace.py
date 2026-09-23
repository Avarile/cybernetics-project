# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace serializer used by the instance-admin workspace list/create endpoints."""

# Third Party Imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from .user import UserLiteSerializer
from plane.db.models import Workspace
from plane.utils.constants import RESTRICTED_WORKSPACE_SLUGS
from plane.utils.content_validator import has_alphanumeric
from plane.utils.url import contains_url


class WorkspaceSerializer(BaseSerializer):
    """Workspace serializer for god mode, with owner details and read-only project/member counts.

    ``logo_url``, ``total_projects`` and ``total_members`` are expected to be supplied by the
    view's queryset (annotations/properties); they are never written.
    """

    owner = UserLiteSerializer(read_only=True)
    logo_url = serializers.CharField(read_only=True)
    total_projects = serializers.IntegerField(read_only=True)
    total_members = serializers.IntegerField(read_only=True)

    def validate_name(self, value):
        """Reject names containing URLs or lacking any alphanumeric character."""
        # Check if the name contains a URL (kept consistent with the app-level
        # WorkSpaceSerializer so both workspace-create paths validate alike).
        if contains_url(value):
            raise serializers.ValidationError("Name must not contain URLs")
        # Reject symbol-only names like "-_________-" that have no letter or
        # digit. Mirrors the frontend HAS_ALPHANUMERIC_REGEX check so the rule
        # cannot be bypassed via a direct API call.
        if not has_alphanumeric(value):
            raise serializers.ValidationError(
                "Name must contain at least one letter or number"
            )
        return value

    def validate_slug(self, value):
        """Reject reserved slugs and slugs already taken (case-insensitive)."""
        # Check if the slug is restricted
        if value in RESTRICTED_WORKSPACE_SLUGS:
            raise serializers.ValidationError("Slug is not valid")
        # Check uniqueness case-insensitively
        if Workspace.objects.filter(slug__iexact=value).exists():
            raise serializers.ValidationError("Slug is already in use")
        return value

    class Meta:
        model = Workspace
        fields = "__all__"
        read_only_fields = [
            "id",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "owner",
            "logo_url",
        ]
