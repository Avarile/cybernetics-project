# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializer for InstanceConfiguration key/value rows exposed to instance admins."""

from .base import BaseSerializer
from plane.license.models import InstanceConfiguration
from plane.license.utils.encryption import decrypt_data


class InstanceConfigurationSerializer(BaseSerializer):
    """Serializes instance configuration entries, returning secrets decrypted."""

    class Meta:
        model = InstanceConfiguration
        fields = "__all__"

    def to_representation(self, instance):
        """Decrypt the ``value`` of encrypted entries so admins see the plain value."""
        data = super().to_representation(instance)
        # Decrypt secrets value
        if instance.is_encrypted and instance.value is not None:
            data["value"] = decrypt_data(instance.value)

        return data
