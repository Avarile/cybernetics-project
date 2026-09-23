# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for projects, project members/invites, project identifiers and deploy boards (public project views)."""

# Third party imports
from rest_framework import serializers

# Python imports
import re

# Module imports
from .base import BaseSerializer, DynamicBaseSerializer
from django.db.models import Max
from plane.app.serializers.workspace import WorkspaceLiteSerializer
from plane.app.serializers.user import UserLiteSerializer, UserAdminLiteSerializer
from plane.db.models import (
    Project,
    ProjectMember,
    ProjectMemberInvite,
    ProjectIdentifier,
    DeployBoard,
    ProjectPublicMember,
    IssueSequence,
)
from plane.utils.content_validator import (
    validate_html_content,
)


class ProjectSerializer(BaseSerializer):
    """Project create/update serializer.

    Validates that name and identifier are free of forbidden characters and unique
    within ``context["workspace_id"]``, and sanitizes ``description_html``.
    """

    workspace_detail = WorkspaceLiteSerializer(source="workspace", read_only=True)
    inbox_view = serializers.BooleanField(read_only=True, source="intake_view")

    class Meta:
        model = Project
        fields = "__all__"
        read_only_fields = ["workspace", "deleted_at"]

    def validate_name(self, name):
        """Reject names with forbidden characters or already used by another project in the workspace."""
        project_id = self.instance.id if self.instance else None
        workspace_id = self.context["workspace_id"]

        if re.match(Project.FORBIDDEN_IDENTIFIER_CHARS_PATTERN, name):
            raise serializers.ValidationError(detail="PROJECT_NAME_CANNOT_CONTAIN_SPECIAL_CHARACTERS")

        project = Project.objects.filter(name=name, workspace_id=workspace_id)

        if project_id:
            project = project.exclude(id=project_id)

        if project.exists():
            raise serializers.ValidationError(
                detail="PROJECT_NAME_ALREADY_EXIST",
            )

        return name

    def validate_identifier(self, identifier):
        """Reject identifiers with forbidden characters or already used by another project in the workspace."""
        project_id = self.instance.id if self.instance else None
        workspace_id = self.context["workspace_id"]

        if re.match(Project.FORBIDDEN_IDENTIFIER_CHARS_PATTERN, identifier):
            raise serializers.ValidationError(detail="PROJECT_IDENTIFIER_CANNOT_CONTAIN_SPECIAL_CHARACTERS")

        project = Project.objects.filter(identifier=identifier, workspace_id=workspace_id)

        if project_id:
            project = project.exclude(id=project_id)

        if project.exists():
            raise serializers.ValidationError(
                detail="PROJECT_IDENTIFIER_ALREADY_EXIST",
            )

        return identifier

    def validate(self, data):
        """Sanitize ``description_html`` and reject invalid HTML."""
        # Validate description content for security
        if "description_html" in data and data["description_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(str(data["description_html"]))
            # Update the data with sanitized HTML if available
            if sanitized_html is not None:
                data["description_html"] = sanitized_html

            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})

        return data

    def create(self, validated_data):
        """Create the project in ``context["workspace_id"]`` and reserve its identifier (ProjectIdentifier)."""
        workspace_id = self.context["workspace_id"]

        project = Project.objects.create(**validated_data, workspace_id=workspace_id)

        ProjectIdentifier.objects.create(name=project.identifier, project=project, workspace_id=workspace_id)

        return project


class ProjectLiteSerializer(BaseSerializer):
    """Minimal read-only project representation used for nesting."""

    class Meta:
        model = Project
        fields = [
            "id",
            "identifier",
            "name",
            "cover_image",
            "cover_image_url",
            "logo_props",
            "description",
        ]
        read_only_fields = fields


class ProjectListSerializer(DynamicBaseSerializer):
    """Project list item with user-specific annotations (favorite, sort order, role) and member ids."""

    is_favorite = serializers.BooleanField(read_only=True)
    sort_order = serializers.FloatField(read_only=True)
    member_role = serializers.IntegerField(read_only=True)
    anchor = serializers.CharField(read_only=True)
    members = serializers.SerializerMethodField()
    cover_image_url = serializers.CharField(read_only=True)
    inbox_view = serializers.BooleanField(read_only=True, source="intake_view")
    next_work_item_sequence = serializers.SerializerMethodField()

    def get_members(self, obj):
        """Active, non-bot member ids from the prefetched ``members_list`` (empty if not prefetched)."""
        project_members = getattr(obj, "members_list", None)
        if project_members is not None:
            # Filter members by the project ID
            return [member.member_id for member in project_members if member.is_active and not member.member.is_bot]
        return []

    def get_next_work_item_sequence(self, obj):
        """Get the next sequence ID that will be assigned to a new issue"""
        max_sequence = IssueSequence.objects.filter(project_id=obj.id).aggregate(max_seq=Max("sequence"))["max_seq"]
        # NOTE: runs one aggregate query per project serialized
        return (max_sequence + 1) if max_sequence else 1

    class Meta:
        model = Project
        fields = "__all__"


class ProjectDetailSerializer(BaseSerializer):
    """Project detail with nested default assignee/lead and user-specific annotations."""

    # workspace = WorkSpaceSerializer(read_only=True)
    default_assignee = UserLiteSerializer(read_only=True)
    project_lead = UserLiteSerializer(read_only=True)
    is_favorite = serializers.BooleanField(read_only=True)
    sort_order = serializers.FloatField(read_only=True)
    member_role = serializers.IntegerField(read_only=True)
    anchor = serializers.CharField(read_only=True)

    class Meta:
        model = Project
        fields = "__all__"


class ProjectMemberSerializer(BaseSerializer):
    """Project membership with nested workspace, project and member details."""

    workspace = WorkspaceLiteSerializer(read_only=True)
    project = ProjectLiteSerializer(read_only=True)
    member = UserLiteSerializer(read_only=True)

    class Meta:
        model = ProjectMember
        fields = "__all__"


class ProjectMemberPreferenceSerializer(BaseSerializer):
    """Updates a member's per-project preferences (merged into the existing dict)."""

    class Meta:
        model = ProjectMember
        fields = ["preferences", "project_id", "member_id", "workspace_id"]

    def validate_preferences(self, value):
        """Merge the incoming keys into the existing preferences instead of replacing them."""
        preferences = self.instance.preferences

        preferences.update(value)
        return preferences


class ProjectMemberAdminSerializer(BaseSerializer):
    """Project membership with admin-level member details (e.g. email)."""

    workspace = WorkspaceLiteSerializer(read_only=True)
    project = ProjectLiteSerializer(read_only=True)
    member = UserAdminLiteSerializer(read_only=True)

    class Meta:
        model = ProjectMember
        fields = "__all__"


class ProjectMemberRoleSerializer(DynamicBaseSerializer):
    """Project membership role; ``original_role`` exposes the stored role read-only."""

    original_role = serializers.IntegerField(source="role", read_only=True)

    class Meta:
        model = ProjectMember
        fields = ("id", "role", "member", "project", "original_role", "created_at")
        read_only_fields = ["original_role", "created_at"]


class ProjectMemberInviteSerializer(BaseSerializer):
    """Project invitation with nested project/workspace details (authenticated use)."""

    project = ProjectLiteSerializer(read_only=True)
    workspace = WorkspaceLiteSerializer(read_only=True)

    class Meta:
        model = ProjectMemberInvite
        fields = "__all__"


class ProjectMemberInvitePublicSerializer(BaseSerializer):
    """Safe read-only serializer for the public project invite GET endpoint.

    Intentionally excludes ``email`` and ``token`` so that an unauthenticated
    caller cannot retrieve the invitee's email address or the acceptance token
    (GHSA-2r58-hgv7-635q).
    """

    project = ProjectLiteSerializer(read_only=True)
    workspace = WorkspaceLiteSerializer(read_only=True)

    class Meta:
        model = ProjectMemberInvite
        fields = [
            "id",
            "project",
            "workspace",
            "role",
            "message",
            "accepted",
            "responded_at",
        ]
        read_only_fields = fields


class ProjectIdentifierSerializer(BaseSerializer):
    """Reserved project identifier within a workspace."""

    class Meta:
        model = ProjectIdentifier
        fields = "__all__"


class ProjectMemberLiteSerializer(BaseSerializer):
    """Minimal membership (member details, id, subscription flag)."""

    member = UserLiteSerializer(read_only=True)
    is_subscribed = serializers.BooleanField(read_only=True)

    class Meta:
        model = ProjectMember
        fields = ["member", "id", "is_subscribed"]
        read_only_fields = fields


class DeployBoardSerializer(BaseSerializer):
    """Deploy board: publishing settings that expose a project on the public space app."""

    project_details = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")

    class Meta:
        model = DeployBoard
        fields = "__all__"
        read_only_fields = ["workspace", "project", "anchor"]


class ProjectPublicMemberSerializer(BaseSerializer):
    """Member of a project's public deploy board."""

    class Meta:
        model = ProjectPublicMember
        fields = "__all__"
        read_only_fields = ["workspace", "project", "member"]
