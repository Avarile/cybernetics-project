# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF permission classes for workspace-scoped endpoints.

Classes read ``view.workspace_slug`` (from URL kwargs) and check the user's
active WorkspaceMember role. Note that in this codebase "owner" and "admin"
both map to the Admin role (20).
"""

# Third Party imports
from rest_framework.permissions import BasePermission, SAFE_METHODS

# Module imports
from plane.db.models import WorkspaceMember


# Permission Mappings
Admin = 20
Member = 15
Guest = 5


# TODO: Move the below logic to python match - python v3.10
class WorkSpaceBasePermission(BasePermission):
    """Permission for the workspace resource itself.

    Any authenticated user may create or read (list is filtered by the queryset),
    admin/member may update, and only admins may delete.
    """

    def has_permission(self, request, view):
        # allow anyone to create a workspace
        if request.user.is_anonymous:
            return False

        if request.method == "POST":
            return True

        ## Safe Methods
        if request.method in SAFE_METHODS:
            return True

        # allow only admins and owners to update the workspace settings
        if request.method in ["PUT", "PATCH"]:
            return WorkspaceMember.objects.filter(
                member=request.user,
                workspace__slug=view.workspace_slug,
                role__in=[Admin, Member],
                is_active=True,
            ).exists()

        # allow only owner to delete the workspace
        if request.method == "DELETE":
            return WorkspaceMember.objects.filter(
                member=request.user,
                workspace__slug=view.workspace_slug,
                role=Admin,
                is_active=True,
            ).exists()


class WorkspaceOwnerPermission(BasePermission):
    """Allow only workspace admins (role 20)."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            workspace__slug=view.workspace_slug, member=request.user, role=Admin, is_active=True
        ).exists()


class WorkSpaceAdminPermission(BasePermission):
    """Allow workspace admins and members (excludes guests)."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=view.workspace_slug,
            role__in=[Admin, Member],
            is_active=True,
        ).exists()


class WorkspaceEntityPermission(BasePermission):
    """Permission for workspace-level entities: any member may read, admin/member may write."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        ## Safe Methods -> Handle the filtering logic in queryset
        if request.method in SAFE_METHODS:
            return WorkspaceMember.objects.filter(
                workspace__slug=view.workspace_slug, member=request.user, is_active=True
            ).exists()

        return WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=view.workspace_slug,
            role__in=[Admin, Member],
            is_active=True,
        ).exists()


class WorkspaceViewerPermission(BasePermission):
    """Allow any active workspace member (read-only style access check)."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            member=request.user, workspace__slug=view.workspace_slug, is_active=True
        ).exists()


class WorkspaceUserPermission(BasePermission):
    """Allow any active workspace member regardless of role."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            member=request.user, workspace__slug=view.workspace_slug, is_active=True
        ).exists()


class WorkspaceMemberPermission(BasePermission):
    """Allows access only to active workspace members.

    Resolves the workspace via 'slug' or 'workspace_id' in URL kwargs so this
    class can be used on endpoints that identify the workspace by either
    identifier (e.g. FileAssetEndpoint which mixes both URL patterns).
    """

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        workspace_id = view.kwargs.get("workspace_id")
        if workspace_id:
            return WorkspaceMember.objects.filter(
                workspace_id=workspace_id, member=request.user, is_active=True
            ).exists()

        slug = view.kwargs.get("slug")
        if slug:
            return WorkspaceMember.objects.filter(
                workspace__slug=slug, member=request.user, is_active=True
            ).exists()

        return False
