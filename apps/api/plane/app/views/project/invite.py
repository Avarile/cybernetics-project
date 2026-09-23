# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project invitation API.

Project admins invite users by email (JWT token per invite), workspace
members join projects directly, and invitees accept/decline an invite via
a public (AllowAny) join endpoint.
"""
# Python imports
import jwt
from datetime import datetime

# Django imports
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.conf import settings
from django.utils import timezone

# Third Party imports
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

# Module imports
from .base import BaseViewSet, BaseAPIView
from plane.app.serializers import (
    ProjectMemberInviteSerializer,
    ProjectMemberInvitePublicSerializer,
)
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import (
    ProjectMember,
    Workspace,
    ProjectMemberInvite,
    User,
    WorkspaceMember,
    Project,
    ProjectUserProperty,
)
from plane.db.models.project import ProjectNetwork
from plane.utils.host import base_host


class ProjectInvitationsViewset(BaseViewSet):
    """Admin-side management of email invitations to a project."""
    serializer_class = ProjectMemberInviteSerializer
    model = ProjectMemberInvite

    search_fields = []

    def get_queryset(self):
        """Invitations for the project in the URL."""
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .select_related("project")
            .select_related("workspace", "workspace__owner")
        )

    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id):
        """Create email invitations for ``request.data["emails"]`` (list of {email, role}).

        Invitee roles must match their workspace role when that role is
        guest (5) or admin (20). Invites are bulk-created with a signed JWT token.
        """
        emails = request.data.get("emails", [])

        # Check if email is provided
        if not emails:
            return Response({"error": "Emails are required"}, status=status.HTTP_400_BAD_REQUEST)

        for email in emails:
            # NOTE: ``.role`` is read directly off a QuerySet here, not a model
            # instance.
            workspace_role = WorkspaceMember.objects.filter(
                workspace__slug=slug, member__email=email.get("email"), is_active=True
            ).role

            if workspace_role in [5, 20] and workspace_role != email.get("role", 5):
                return Response({"error": "You cannot invite a user with different role than workspace role"})

        workspace = Workspace.objects.get(slug=slug)

        project_invitations = []
        for email in emails:
            try:
                validate_email(email.get("email"))
                project_invitations.append(
                    ProjectMemberInvite(
                        email=email.get("email").strip().lower(),
                        project_id=project_id,
                        workspace_id=workspace.id,
                        token=jwt.encode(
                            {"email": email, "timestamp": datetime.now().timestamp()},
                            settings.SECRET_KEY,
                            algorithm="HS256",
                        ),
                        role=email.get("role", 5),
                        created_by=request.user,
                    )
                )
            except ValidationError:
                return Response(
                    {
                        "error": f"Invalid email - {email} provided a valid email address is required to send the invite"  # noqa: E501
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Create workspace member invite
        project_invitations = ProjectMemberInvite.objects.bulk_create(
            project_invitations, batch_size=10, ignore_conflicts=True
        )
        current_site = base_host(request=request, is_app=True)

        # Send invitations
        # NOTE: ``.delay`` is called on the local list of invitations, not on
        # a Celery task.
        for invitation in project_invitations:
            project_invitations.delay(
                invitation.email,
                project_id,
                invitation.token,
                current_site,
                request.user.email,
            )

        return Response({"message": "Email sent successfully"}, status=status.HTTP_200_OK)


class UserProjectInvitationsViewset(BaseViewSet):
    """Current user's project invitations and direct project joining."""
    serializer_class = ProjectMemberInviteSerializer
    model = ProjectMemberInvite

    def get_queryset(self):
        """Invitations addressed to the current user's email."""
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(email=self.request.user.email)
            .select_related("workspace", "workspace__owner", "project")
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def create(self, request, slug):
        """Join the projects in ``project_ids`` with the user's workspace role.

        Secret projects can only be joined by workspace admins. Existing
        memberships are reactivated; new ProjectMember and ProjectUserProperty
        rows are created (duplicates ignored).
        """
        project_ids = request.data.get("project_ids", [])

        # Get the workspace user role
        workspace_member = WorkspaceMember.objects.get(member=request.user, workspace__slug=slug, is_active=True)

        # Get all the projects
        projects = Project.objects.filter(id__in=project_ids, workspace__slug=slug).only("id", "network")
        # Check if user has permission to join each project
        for project in projects:
            if project.network == ProjectNetwork.SECRET.value and workspace_member.role != ROLE.ADMIN.value:
                return Response(
                    {"error": "Only workspace admins can join private project"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        workspace_role = workspace_member.role
        workspace = workspace_member.workspace

        # If the user was already part of workspace
        _ = ProjectMember.objects.filter(workspace__slug=slug, project_id__in=project_ids, member=request.user).update(
            is_active=True
        )

        ProjectMember.objects.bulk_create(
            [
                ProjectMember(
                    project_id=project_id,
                    member=request.user,
                    role=workspace_role,
                    workspace=workspace,
                    created_by=request.user,
                )
                for project_id in project_ids
            ],
            ignore_conflicts=True,
        )

        ProjectUserProperty.objects.bulk_create(
            [
                ProjectUserProperty(
                    project_id=project_id,
                    user=request.user,
                    workspace=workspace,
                    created_by=request.user,
                )
                for project_id in project_ids
            ],
            ignore_conflicts=True,
        )

        return Response({"message": "Projects joined successfully"}, status=status.HTTP_201_CREATED)


class ProjectJoinEndpoint(BaseAPIView):
    """Public endpoint to view and respond to a project invitation."""
    permission_classes = [AllowAny]

    def post(self, request, slug, project_id, pk):
        """Accept or decline an invitation; the body ``email`` must match the invite.

        On acceptance, ensures an active workspace membership (role capped at
        member/15) and an active project membership. An invite can only be
        answered once.
        """
        project_invite = ProjectMemberInvite.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)

        email = request.data.get("email", "")

        if email == "" or project_invite.email != email:
            return Response(
                {"error": "You do not have permission to join the project"},
                status=status.HTTP_403_FORBIDDEN,
            )

        if project_invite.responded_at is None:
            project_invite.accepted = request.data.get("accepted", False)
            project_invite.responded_at = timezone.now()
            project_invite.save()

            if project_invite.accepted:
                # Check if the user account exists
                user = User.objects.filter(email=email).first()

                # Check if user is a part of workspace
                workspace_member = WorkspaceMember.objects.filter(workspace__slug=slug, member=user).first()
                # Add him to workspace
                if workspace_member is None:
                    _ = WorkspaceMember.objects.create(
                        workspace_id=project_invite.workspace_id,
                        member=user,
                        role=(15 if project_invite.role >= 15 else project_invite.role),
                    )
                else:
                    # Else make him active
                    workspace_member.is_active = True
                    workspace_member.save()

                # Check if the user was already a member of project then activate the user
                project_member = ProjectMember.objects.filter(
                    workspace_id=project_invite.workspace_id, member=user
                ).first()
                if project_member is None:
                    # Create a Project Member
                    _ = ProjectMember.objects.create(
                        project_id=project_id,
                        member=user,
                        role=project_invite.role,
                    )
                else:
                    project_member.is_active = True
                    project_member.role = project_member.role
                    project_member.save()

                return Response(
                    {"message": "Project Invitation Accepted"},
                    status=status.HTTP_200_OK,
                )

            return Response(
                {"message": "Project Invitation was not accepted"},
                status=status.HTTP_200_OK,
            )

        return Response(
            {"error": "You have already responded to the invitation request"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def get(self, request, slug, project_id, pk):
        """Return public details of a project invitation."""
        project_invitation = ProjectMemberInvite.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)
        serializer = ProjectMemberInvitePublicSerializer(project_invitation)
        return Response(serializer.data, status=status.HTTP_200_OK)
