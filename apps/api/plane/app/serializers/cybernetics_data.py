# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for the Cybernetics Data integration (external database records linked to work items).

Covers the per-project integration config (base URL + API token, never
returned to clients), connection testing, attaching external records to an
issue, and the read representation of attached records (``IssueCyberneticsRecord``).
Used by the views routed in ``plane/app/urls/cybernetics_data.py``.
"""

# Django imports
from django.conf import settings

# Third party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from plane.db.models import IssueCyberneticsRecord, ProjectCyberneticsDataIntegration
from plane.utils.cybernetics_data.client import normalize_base_url
from plane.utils.cybernetics_data.filters import QueryValidationError, validate_id
from plane.utils.cybernetics_data.service import MAX_RECORDS_PER_REQUEST, build_deep_link
from plane.utils.ip_address import validate_url


def validate_cybernetics_base_url(value):
    """Normalize and SSRF-check an integration base URL.

    The URL must resolve to an allowed IP/host per ``CYBERNETICS_DATA_ALLOWED_IPS``
    / ``CYBERNETICS_DATA_ALLOWED_HOSTS``. Returns the normalized URL or raises
    ValidationError.
    """
    try:
        url = normalize_base_url(value)
        validate_url(
            url,
            allowed_ips=settings.CYBERNETICS_DATA_ALLOWED_IPS,
            allowed_hosts=settings.CYBERNETICS_DATA_ALLOWED_HOSTS,
        )
    except ValueError as e:
        raise serializers.ValidationError(f"Invalid or disallowed URL. {e}")
    return url


class ProjectCyberneticsDataIntegrationSerializer(BaseSerializer):
    """Public representation — the token is never included."""

    is_configured = serializers.SerializerMethodField()

    class Meta:
        model = ProjectCyberneticsDataIntegration
        fields = [
            "id",
            "project",
            "is_configured",
            "is_enabled",
            "base_url",
            "token_hint",
            "last_verified_at",
            "last_verified_status",
            "last_verified_message",
            "updated_at",
            "updated_by",
        ]
        read_only_fields = fields

    def get_is_configured(self, obj):
        """Always True: an integration row only exists once the project has been configured."""
        return True


class ProjectCyberneticsDataIntegrationWriteSerializer(serializers.Serializer):
    """Input for creating/updating a project's integration config.

    ``api_token`` is write-only; ``skip_verification`` lets the caller save without
    a live connection check.
    """

    base_url = serializers.CharField(max_length=2048, required=False)
    api_token = serializers.CharField(
        max_length=1024, required=False, allow_blank=True, write_only=True, trim_whitespace=True
    )
    is_enabled = serializers.BooleanField(required=False)
    skip_verification = serializers.BooleanField(required=False, default=False)

    def validate_base_url(self, value):
        """Normalize and validate the base URL against the allowed hosts/IPs."""
        return validate_cybernetics_base_url(value)


class CyberneticsConnectionTestSerializer(serializers.Serializer):
    """Input for a connection test; blank fields are allowed (the view may fall back to saved config)."""

    base_url = serializers.CharField(max_length=2048, required=False, allow_blank=True)
    api_token = serializers.CharField(
        max_length=1024, required=False, allow_blank=True, write_only=True, trim_whitespace=True
    )

    def validate_base_url(self, value):
        """Validate the base URL only when one is provided."""
        return validate_cybernetics_base_url(value) if value else value


class CyberneticsRecordRefSerializer(serializers.Serializer):
    """Reference to one external record (base/table/record ids, optional view id)."""

    base_id = serializers.CharField(max_length=64)
    table_id = serializers.CharField(max_length=64)
    record_id = serializers.CharField(max_length=64)
    view_id = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        """Validate that each id has the expected format for its kind (base/table/record/view)."""
        try:
            validate_id(attrs["base_id"], "base")
            validate_id(attrs["table_id"], "table")
            validate_id(attrs["record_id"], "record")
            if attrs.get("view_id"):
                validate_id(attrs["view_id"], "view")
        except QueryValidationError as e:
            raise serializers.ValidationError(str(e))
        return attrs


class CyberneticsRecordAttachSerializer(serializers.Serializer):
    """Payload for attaching external records to an issue (1..MAX_RECORDS_PER_REQUEST refs)."""

    records = CyberneticsRecordRefSerializer(many=True, allow_empty=False, max_length=MAX_RECORDS_PER_REQUEST)


class IssueCyberneticsRecordSerializer(BaseSerializer):
    """Read-only representation of an external record attached to an issue, including a deep link."""

    deep_link = serializers.SerializerMethodField()

    class Meta:
        model = IssueCyberneticsRecord
        fields = [
            "id",
            "issue_id",
            "project_id",
            "space_id",
            "base_id",
            "base_name",
            "table_id",
            "table_name",
            "record_id",
            "record_name",
            "view_id",
            "preview",
            "source_url",
            "deep_link",
            "snapshot_at",
            "status",
            "created_by",
            "created_at",
        ]
        read_only_fields = fields

    def get_deep_link(self, obj):
        """Build a deep link from ``context["base_url"]`` when available, else fall back to the stored source URL."""
        base_url = self.context.get("base_url")
        if base_url:
            return build_deep_link(base_url, obj.base_id, obj.table_id, obj.record_id)
        return obj.source_url
