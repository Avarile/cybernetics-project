# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF permission restricting the instance-admin API to instance admins."""

# Third party imports
from rest_framework.permissions import BasePermission

# Module imports
from plane.license.models import Instance, InstanceAdmin


class InstanceAdminPermission(BasePermission):
    """Allow access only to authenticated users who are admins of this instance."""

    def has_permission(self, request, view):
        """Return True if the user has an InstanceAdmin row with role >= 15 (admin).

        Only the first Instance row is considered: a deployment hosts a single instance.
        """
        if request.user.is_anonymous:
            return False

        instance = Instance.objects.first()
        return InstanceAdmin.objects.filter(role__gte=15, instance=instance, user=request.user).exists()
