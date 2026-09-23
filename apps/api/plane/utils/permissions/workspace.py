# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Workspace-level DRF permission classes.

Views using these must expose a ``workspace_slug`` attribute. Membership is
checked against active WorkspaceMember rows using the role values below.
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
    """
    Permission for workspace CRUD endpoints.

    Any authenticated user may create or read (reads are scoped by the view's
    queryset); updates need Admin/Member role; delete needs Admin role.
    Other methods fall through and return None (falsy -> denied).
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
    """Allow only workspace admins (the "owner" level; there is no separate owner role)."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            workspace__slug=view.workspace_slug, member=request.user, role=Admin, is_active=True
        ).exists()


class WorkSpaceAdminPermission(BasePermission):
    """Allow workspace Admins and Members (excludes Guests), for any method."""

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
    """Reads: any active workspace member. Writes: workspace Admins/Members."""

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
    """Allow any active workspace member (any role), for any method."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            member=request.user, workspace__slug=view.workspace_slug, is_active=True
        ).exists()


class WorkspaceUserPermission(BasePermission):
    """Allow any active workspace member; currently identical to WorkspaceViewerPermission."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            member=request.user, workspace__slug=view.workspace_slug, is_active=True
        ).exists()
