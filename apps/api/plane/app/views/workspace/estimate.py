# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-level estimate listing.

Returns the estimate systems (with their points) that are in use by projects of a workspace.
"""

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import WorkspaceEntityPermission
from plane.app.serializers import WorkspaceEstimateSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Estimate, Project
from plane.utils.cache import cache_response


class WorkspaceEstimatesEndpoint(BaseAPIView):
    """List estimates attached to any project in the workspace; served from the read replica."""

    permission_classes = [WorkspaceEntityPermission]
    use_read_replica = True

    @cache_response(60 * 60 * 2)
    def get(self, request, slug):
        """Return estimates referenced by workspace projects. Response is cached for 2 hours."""
        # Only estimates actually assigned to a project (Project.estimate) are returned.
        estimate_ids = Project.objects.filter(workspace__slug=slug, estimate__isnull=False).values_list(
            "estimate_id", flat=True
        )
        estimates = (
            Estimate.objects.filter(pk__in=estimate_ids, workspace__slug=slug)
            .prefetch_related("points")
            .select_related("workspace", "project")
        )

        serializer = WorkspaceEstimateSerializer(estimates, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
