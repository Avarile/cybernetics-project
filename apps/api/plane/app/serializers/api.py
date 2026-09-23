# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for personal API tokens and the API request activity log."""

from .base import BaseSerializer
from plane.db.models import APIToken, APIActivityLog
from rest_framework import serializers
from django.utils import timezone


class APITokenSerializer(BaseSerializer):
    """Write serializer for APIToken; the token value and system-managed fields are read-only."""

    class Meta:
        model = APIToken
        fields = "__all__"
        read_only_fields = [
            "token",
            "expired_at",
            "created_at",
            "updated_at",
            "workspace",
            "user",
            "is_active",
            "last_used",
            "user_type",
            "allowed_rate_limit",
        ]


class APITokenReadSerializer(BaseSerializer):
    """Read serializer for APIToken that hides the secret token and computes ``is_active`` from expiry."""

    is_active = serializers.SerializerMethodField()

    class Meta:
        model = APIToken
        exclude = ("token",)

    def get_is_active(self, obj: APIToken) -> bool:
        """A token is active if it has no expiry or the expiry is still in the future."""
        if obj.expired_at is None:
            return True
        return timezone.now() < obj.expired_at


class APIActivityLogSerializer(BaseSerializer):
    """Serializer for APIActivityLog records (per-request log of public API calls)."""

    class Meta:
        model = APIActivityLog
        fields = "__all__"
