# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace management endpoints for god mode (``/api/instances/workspaces/``).

Lets instance admins check slug availability, list all workspaces on the instance with
project/member counts, and create new workspaces.
"""

# Third party imports
from rest_framework.response import Response
from rest_framework import status
from django.db import IntegrityError
from django.db.models import OuterRef, Func, F

# Module imports
from plane.app.views.base import BaseAPIView
from plane.license.api.permissions import InstanceAdminPermission
from plane.db.models import Workspace, WorkspaceMember, Project
from plane.license.api.serializers import WorkspaceSerializer
from plane.utils.constants import RESTRICTED_WORKSPACE_SLUGS


class InstanceWorkSpaceAvailabilityCheckEndpoint(BaseAPIView):
    """Check whether a workspace slug is free (instance admins only)."""

    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        """Return ``{"status": True}`` if ``?slug=`` is neither taken (case-insensitive) nor reserved."""
        slug = request.GET.get("slug", False)

        if not slug or slug == "":
            return Response(
                {"error": "Workspace Slug is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workspace = Workspace.objects.filter(slug__iexact=slug).exists() or slug in RESTRICTED_WORKSPACE_SLUGS
        return Response({"status": not workspace}, status=status.HTTP_200_OK)


class InstanceWorkSpaceEndpoint(BaseAPIView):
    """List and create workspaces across the whole instance (instance admins only)."""

    model = Workspace
    serializer_class = WorkspaceSerializer
    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        """Return a paginated list (10 per page) of all workspaces, optionally filtered by ``?search=`` on name.

        Each workspace is annotated with ``total_projects`` and ``total_members`` (active, non-bot members).
        """
        # Correlated subqueries: COUNT(id) per workspace. ``order_by()`` clears default ordering so the
        # aggregate isn't grouped by extra columns.
        project_count = (
            Project.objects.filter(workspace_id=OuterRef("id"))
            .order_by()
            .annotate(count=Func(F("id"), function="Count"))
            .values("count")
        )

        member_count = (
            WorkspaceMember.objects.filter(workspace=OuterRef("id"), member__is_bot=False, is_active=True)
            .select_related("owner")
            .order_by()
            .annotate(count=Func(F("id"), function="Count"))
            .values("count")
        )

        workspaces = Workspace.objects.annotate(total_projects=project_count, total_members=member_count)

        # Add search functionality
        search = request.query_params.get("search", None)
        if search:
            workspaces = workspaces.filter(name__icontains=search)

        return self.paginate(
            request=request,
            queryset=workspaces,
            on_results=lambda results: WorkspaceSerializer(results, many=True).data,
            max_per_page=10,
            default_per_page=10,
        )

    def post(self, request):
        """Create a workspace owned by the requesting admin and add them as a member with role 20 (admin).

        Validates presence and length of name/slug (80/48 chars max). A duplicate slug that slips
        past validation surfaces as an IntegrityError and returns 409.
        """
        try:
            serializer = WorkspaceSerializer(data=request.data)

            slug = request.data.get("slug", False)
            name = request.data.get("name", False)

            if not name or not slug:
                return Response(
                    {"error": "Both name and slug are required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if len(name) > 80 or len(slug) > 48:
                return Response(
                    {"error": "The maximum length for name is 80 and for slug is 48"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if serializer.is_valid(raise_exception=True):
                serializer.save(owner=request.user)
                # Create Workspace member
                _ = WorkspaceMember.objects.create(
                    workspace_id=serializer.data["id"],
                    member=request.user,
                    role=20,
                    company_role=request.data.get("company_role", ""),
                )
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(
                [serializer.errors[error][0] for error in serializer.errors],
                status=status.HTTP_400_BAD_REQUEST,
            )

        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"slug": "The workspace with the slug already exists"},
                    status=status.HTTP_409_CONFLICT,
                )
