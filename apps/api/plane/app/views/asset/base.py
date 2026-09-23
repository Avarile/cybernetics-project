# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Legacy (v1) file asset endpoints.

Workspace assets are addressed by ``<workspace_id>/<asset_key>``; user assets
by the bare key and scoped to their creator. Deletion is a soft delete via
the ``is_deleted`` flag. Newer uploads go through the presigned-URL flow in
``asset/v2.py``.
"""

# Third party imports
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

# Module imports
from ..base import BaseAPIView, BaseViewSet
from plane.app.permissions import WorkspaceMemberPermission
from plane.db.models import FileAsset, Workspace
from plane.app.serializers import FileAssetSerializer


class FileAssetEndpoint(BaseAPIView):
    """Upload, fetch and soft-delete workspace file assets (workspace members only)."""

    parser_classes = (MultiPartParser, FormParser, JSONParser)
    permission_classes = [IsAuthenticated, WorkspaceMemberPermission]

    """
    A viewset for viewing and editing task instances.
    """

    def get(self, request, workspace_id, asset_key):
        """Return the asset(s) stored under ``<workspace_id>/<asset_key>``.

        Missing assets return 200 with ``status: False`` rather than a 404.
        """
        asset_key = str(workspace_id) + "/" + asset_key
        files = FileAsset.objects.filter(asset=asset_key)
        if files.exists():
            serializer = FileAssetSerializer(files, context={"request": request}, many=True)
            return Response({"data": serializer.data, "status": True}, status=status.HTTP_200_OK)
        else:
            return Response(
                {"error": "Asset key does not exist", "status": False},
                status=status.HTTP_200_OK,
            )

    def post(self, request, slug):
        """Upload a new file asset into the workspace identified by ``slug``."""
        # WorkspaceMemberPermission already rejects unknown slugs before this runs.
        # Use .get() so any TOCTOU race still surfaces as a 404 via ObjectDoesNotExist.
        workspace = Workspace.objects.get(slug=slug)
        serializer = FileAssetSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(workspace_id=workspace.id)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, workspace_id, asset_key):
        """Soft-delete a workspace asset by setting ``is_deleted``."""
        asset_key = str(workspace_id) + "/" + asset_key
        file_asset = FileAsset.objects.get(asset=asset_key)
        file_asset.is_deleted = True
        file_asset.save(update_fields=["is_deleted"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class FileAssetViewSet(BaseViewSet):
    """Extra actions on workspace assets (currently restore)."""

    permission_classes = [IsAuthenticated, WorkspaceMemberPermission]

    def restore(self, request, workspace_id, asset_key):
        """Undo a soft delete by clearing ``is_deleted`` on the asset."""
        asset_key = str(workspace_id) + "/" + asset_key
        file_asset = FileAsset.objects.get(asset=asset_key)
        file_asset.is_deleted = False
        file_asset.save(update_fields=["is_deleted"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserAssetsEndpoint(BaseAPIView):
    """Upload, fetch and soft-delete files owned by the current user (e.g. avatars)."""

    parser_classes = (MultiPartParser, FormParser)

    def get(self, request, asset_key):
        """Return the current user's asset for ``asset_key``; missing assets return 200 with ``status: False``."""
        files = FileAsset.objects.filter(asset=asset_key, created_by=request.user)
        if files.exists():
            serializer = FileAssetSerializer(files, context={"request": request})
            return Response({"data": serializer.data, "status": True}, status=status.HTTP_200_OK)
        else:
            return Response(
                {"error": "Asset key does not exist", "status": False},
                status=status.HTTP_200_OK,
            )

    def post(self, request):
        """Upload a new user-level file asset."""
        serializer = FileAssetSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, asset_key):
        """Soft-delete one of the current user's assets."""
        file_asset = FileAsset.objects.get(asset=asset_key, created_by=request.user)
        file_asset.is_deleted = True
        file_asset.save(update_fields=["is_deleted"])
        return Response(status=status.HTTP_204_NO_CONTENT)
