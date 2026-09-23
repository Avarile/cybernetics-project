# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Base serializer shared by the instance-admin (license) API serializers."""

from rest_framework import serializers


class BaseSerializer(serializers.ModelSerializer):
    """ModelSerializer with a read-only primary key ``id`` field."""

    id = serializers.PrimaryKeyRelatedField(read_only=True)
