# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

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
        return True


class ProjectCyberneticsDataIntegrationWriteSerializer(serializers.Serializer):
    base_url = serializers.CharField(max_length=2048, required=False)
    api_token = serializers.CharField(
        max_length=1024, required=False, allow_blank=True, write_only=True, trim_whitespace=True
    )
    is_enabled = serializers.BooleanField(required=False)
    skip_verification = serializers.BooleanField(required=False, default=False)

    def validate_base_url(self, value):
        return validate_cybernetics_base_url(value)


class CyberneticsConnectionTestSerializer(serializers.Serializer):
    base_url = serializers.CharField(max_length=2048, required=False, allow_blank=True)
    api_token = serializers.CharField(
        max_length=1024, required=False, allow_blank=True, write_only=True, trim_whitespace=True
    )

    def validate_base_url(self, value):
        return validate_cybernetics_base_url(value) if value else value


class CyberneticsRecordRefSerializer(serializers.Serializer):
    base_id = serializers.CharField(max_length=64)
    table_id = serializers.CharField(max_length=64)
    record_id = serializers.CharField(max_length=64)
    view_id = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")

    def validate(self, attrs):
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
    records = CyberneticsRecordRefSerializer(many=True, allow_empty=False, max_length=MAX_RECORDS_PER_REQUEST)


class IssueCyberneticsRecordSerializer(BaseSerializer):
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
        base_url = self.context.get("base_url")
        if base_url:
            return build_deep_link(base_url, obj.base_id, obj.table_id, obj.record_id)
        return obj.source_url
