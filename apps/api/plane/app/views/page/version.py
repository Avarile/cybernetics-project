# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Page version history API.

Read-only access to the snapshots recorded by the ``track_page_version``
background task whenever a page description is saved.
"""
# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.db.models import PageVersion
from ..base import BaseAPIView
from plane.app.serializers import PageVersionSerializer, PageVersionDetailSerializer
from plane.app.permissions import ProjectPagePermission


class PageVersionEndpoint(BaseAPIView):
    """List a page's versions or fetch a single version's full detail."""
    permission_classes = [ProjectPagePermission]

    def get(self, request, slug, project_id, page_id, pk=None):
        """Return one version (with content) when ``pk`` is given, else all versions (summary)."""
        # Check if pk is provided
        if pk:
            # Return a single page version
            page_version = PageVersion.objects.get(workspace__slug=slug, page_id=page_id, pk=pk)
            # Serialize the page version
            serializer = PageVersionDetailSerializer(page_version)
            return Response(serializer.data, status=status.HTTP_200_OK)
        # Return all page versions
        page_versions = PageVersion.objects.filter(workspace__slug=slug, page_id=page_id)
        # Serialize the page versions
        serializer = PageVersionSerializer(page_versions, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
