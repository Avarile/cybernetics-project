# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for workspaces and workspace-scoped user data.

Covers workspaces, members and invitations, themes, per-user workspace
properties/preferences, quick links, recent visits, home widgets and stickies.
"""

# Third party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer, DynamicBaseSerializer
from .user import UserLiteSerializer, UserAdminLiteSerializer


from plane.db.models import (
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
    WorkspaceTheme,
    WorkspaceUserProperties,
    WorkspaceUserLink,
    UserRecentVisit,
    Issue,
    Page,
    Project,
    ProjectMember,
    WorkspaceHomePreference,
    Sticky,
    WorkspaceUserPreference,
)
from plane.utils.constants import RESTRICTED_WORKSPACE_SLUGS
from plane.utils.url import contains_url
from plane.utils.content_validator import (
    validate_html_content,
    validate_binary_data,
    has_alphanumeric,
)

# Django imports
from django.core.validators import URLValidator
from django.core.exceptions import ValidationError
import re


class WorkSpaceSerializer(DynamicBaseSerializer):
    """Workspace serializer with annotated member count, logo URL and the requester's role."""

    total_members = serializers.IntegerField(read_only=True)
    logo_url = serializers.CharField(read_only=True)
    role = serializers.IntegerField(read_only=True)

    def validate_name(self, value):
        """Reject names containing URLs or without any letter/digit."""
        # Check if the name contains a URL
        if contains_url(value):
            raise serializers.ValidationError("Name must not contain URLs")
        # Reject symbol-only names like "-_________-" that have no letter or
        # digit. Mirrors the frontend HAS_ALPHANUMERIC_REGEX check so the rule
        # cannot be bypassed via a direct API call.
        if not has_alphanumeric(value):
            raise serializers.ValidationError(
                "Name must contain at least one letter or number"
            )
        return value

    def validate_slug(self, value):
        """Reject reserved slugs and slugs with characters other than letters, digits, ``-`` and ``_``."""
        # Check if the slug is restricted
        if value in RESTRICTED_WORKSPACE_SLUGS:
            raise serializers.ValidationError("Slug is not valid")
        # Slug should only contain alphanumeric characters, hyphens, and underscores
        if not re.match(r"^[a-zA-Z0-9_-]+$", value):
            raise serializers.ValidationError(
                "Slug can only contain letters, numbers, hyphens (-), and underscores (_)"
            )
        return value

    class Meta:
        model = Workspace
        fields = "__all__"
        read_only_fields = [
            "id",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "owner",
            "logo_url",
        ]


class WorkspaceLiteSerializer(BaseSerializer):
    """Minimal read-only workspace representation used for nesting."""

    class Meta:
        model = Workspace
        fields = ["name", "slug", "id", "logo_url"]
        read_only_fields = fields


class WorkSpaceMemberSerializer(DynamicBaseSerializer):
    """Workspace membership with the member's public user details."""

    member = UserLiteSerializer(read_only=True)

    class Meta:
        model = WorkspaceMember
        fields = "__all__"


class WorkspaceMemberMeSerializer(BaseSerializer):
    """The requesting user's own workspace membership, with their annotated draft issue count."""

    draft_issue_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = WorkspaceMember
        fields = "__all__"


class WorkspaceMemberAdminSerializer(DynamicBaseSerializer):
    """Workspace membership with admin-level member details (e.g. email)."""

    member = UserAdminLiteSerializer(read_only=True)

    class Meta:
        model = WorkspaceMember
        fields = "__all__"


class WorkSpaceMemberInviteSerializer(BaseSerializer):
    """Workspace invitation (authenticated/admin use) including the acceptance link with token."""

    workspace = WorkspaceLiteSerializer(read_only=True)
    invite_link = serializers.SerializerMethodField()

    def get_invite_link(self, obj):
        """Relative frontend URL the invitee opens to accept the invitation."""
        return f"/workspace-invitations/?invitation_id={obj.id}&slug={obj.workspace.slug}&token={obj.token}"

    class Meta:
        model = WorkspaceMemberInvite
        fields = "__all__"
        read_only_fields = [
            "id",
            "email",
            "token",
            "workspace",
            "message",
            "responded_at",
            "created_at",
            "updated_at",
            "invite_link",
        ]


class WorkSpaceMemberInvitePublicSerializer(BaseSerializer):
    """Safe read-only serializer for the public workspace invite GET endpoint.

    Intentionally excludes ``token`` and ``invite_link`` so that an
    unauthenticated caller cannot retrieve the acceptance token and use it to
    hijack an invitation (GHSA-86mg-259g-pwgg / GHSA-gf48-p6jp-cwc4).
    """

    workspace = WorkspaceLiteSerializer(read_only=True)

    class Meta:
        model = WorkspaceMemberInvite
        fields = [
            "id",
            "email",
            "workspace",
            "role",
            "message",
            "accepted",
            "responded_at",
            "created_at",
            "updated_at",
            "created_by",
        ]
        read_only_fields = fields


class WorkspaceThemeSerializer(BaseSerializer):
    """Workspace theme created by a user."""

    class Meta:
        model = WorkspaceTheme
        fields = "__all__"
        read_only_fields = ["workspace", "actor"]


class WorkspaceUserPropertiesSerializer(BaseSerializer):
    """Per-user workspace display properties (filters, display settings)."""

    class Meta:
        model = WorkspaceUserProperties
        fields = "__all__"
        read_only_fields = ["workspace", "user"]


class WorkspaceUserLinkSerializer(BaseSerializer):
    """User's quick link in a workspace; URLs are normalized and unique per workspace and owner."""

    class Meta:
        model = WorkspaceUserLink
        fields = "__all__"
        read_only_fields = ["workspace", "owner"]

    def to_internal_value(self, data):
        """Prefix ``http://`` to URLs without a scheme before field validation."""
        url = data.get("url", "")
        if url and not url.startswith(("http://", "https://")):
            data["url"] = "http://" + url

        return super().to_internal_value(data)

    def validate_url(self, value):
        """Validate URL syntax with Django's URLValidator."""
        url_validator = URLValidator()
        try:
            url_validator(value)
        except ValidationError:
            raise serializers.ValidationError({"error": "Invalid URL format."})

        return value

    def create(self, validated_data):
        # Filtering the WorkspaceUserLink with the given url to check if the link already exists.

        url = validated_data.get("url")

        workspace_user_link = WorkspaceUserLink.objects.filter(
            url=url,
            workspace_id=validated_data.get("workspace_id"),
            owner_id=validated_data.get("owner_id"),
        )

        if workspace_user_link.exists():
            raise serializers.ValidationError({"error": "URL already exists for this workspace and owner"})

        return super().create(validated_data)

    def update(self, instance, validated_data):
        # Filtering the WorkspaceUserLink with the given url to check if the link already exists.

        url = validated_data.get("url")

        workspace_user_link = WorkspaceUserLink.objects.filter(
            url=url, workspace_id=instance.workspace_id, owner=instance.owner
        )

        if workspace_user_link.exclude(pk=instance.id).exists():
            raise serializers.ValidationError({"error": "URL already exists for this workspace and owner"})

        return super().update(instance, validated_data)


class IssueRecentVisitSerializer(serializers.ModelSerializer):
    """Issue summary for the "recently visited" list."""

    project_identifier = serializers.SerializerMethodField()
    assignees = serializers.SerializerMethodField()

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "state",
            "priority",
            "assignees",
            "type",
            "sequence_id",
            "project_id",
            "project_identifier",
        ]

    def get_project_identifier(self, obj):
        """Identifier of the issue's project (e.g. used to build ``PROJ-123``)."""
        project = obj.project
        return project.identifier if project else None

    def get_assignees(self, obj):
        """Ids of the issue's current (non-deleted) assignees."""
        return list(obj.assignees.filter(issue_assignee__deleted_at__isnull=True).values_list("id", flat=True))


class ProjectRecentVisitSerializer(serializers.ModelSerializer):
    """Project summary for the "recently visited" list."""

    project_members = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = ["id", "name", "logo_props", "project_members", "identifier"]

    def get_project_members(self, obj):
        """Ids of active, non-bot project members."""
        members = ProjectMember.objects.filter(project_id=obj.id, member__is_bot=False, is_active=True).values_list(
            "member", flat=True
        )

        return members


class PageRecentVisitSerializer(serializers.ModelSerializer):
    """Page summary for the "recently visited" list."""

    project_id = serializers.SerializerMethodField()
    project_identifier = serializers.SerializerMethodField()

    class Meta:
        model = Page
        fields = [
            "id",
            "name",
            "logo_props",
            "project_id",
            "owned_by",
            "project_identifier",
        ]

    def get_project_id(self, obj):
        """Use an annotated ``project_id`` if present, else the first linked project's id."""
        return obj.project_id if hasattr(obj, "project_id") else obj.projects.values_list("id", flat=True).first()

    def get_project_identifier(self, obj):
        """Identifier of the first project the page is linked to."""
        project = obj.projects.first()

        return project.identifier if project else None


def get_entity_model_and_serializer(entity_type):
    """Map a recent-visit ``entity_name`` to ``(model, serializer)``; unknown names return ``(None, None)``."""
    entity_map = {
        "issue": (Issue, IssueRecentVisitSerializer),
        "page": (Page, PageRecentVisitSerializer),
        "project": (Project, ProjectRecentVisitSerializer),
    }
    return entity_map.get(entity_type, (None, None))


class WorkspaceRecentVisitSerializer(BaseSerializer):
    """A user's recent visit with the visited entity embedded as ``entity_data``."""

    entity_data = serializers.SerializerMethodField()

    class Meta:
        model = UserRecentVisit
        fields = ["id", "entity_name", "entity_identifier", "entity_data", "visited_at"]
        read_only_fields = ["workspace", "owner", "created_by", "updated_by"]

    def get_entity_data(self, obj):
        """Load and serialize the visited entity; None if the type is unsupported or it was deleted.

        Note: performs one query per visit.
        """
        entity_name = obj.entity_name
        entity_identifier = obj.entity_identifier

        entity_model, entity_serializer = get_entity_model_and_serializer(entity_name)

        if entity_model and entity_serializer:
            try:
                entity = entity_model.objects.get(pk=entity_identifier)

                return entity_serializer(entity).data
            except entity_model.DoesNotExist:
                return None
        return None


class WorkspaceHomePreferenceSerializer(BaseSerializer):
    """Per-user toggle/order of a workspace home page widget."""

    class Meta:
        model = WorkspaceHomePreference
        fields = ["key", "is_enabled", "sort_order"]
        read_only_fields = ["workspace", "created_by", "updated_by"]


class StickySerializer(BaseSerializer):
    """Personal sticky note in a workspace; descriptions are sanitized."""

    class Meta:
        model = Sticky
        fields = "__all__"
        read_only_fields = ["workspace", "owner"]
        extra_kwargs = {"name": {"required": False}}

    def validate(self, data):
        """Sanitize ``description_html`` and validate ``description_binary``."""
        # Validate description content for security
        if "description_html" in data and data["description_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(data["description_html"])
            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})
            # Update the data with sanitized HTML if available
            if sanitized_html is not None:
                data["description_html"] = sanitized_html

        if "description_binary" in data and data["description_binary"]:
            is_valid, error_msg = validate_binary_data(data["description_binary"])
            if not is_valid:
                raise serializers.ValidationError({"description_binary": "Invalid binary data"})

        return data


class WorkspaceUserPreferenceSerializer(BaseSerializer):
    """Per-user pin/order preference for workspace sidebar items."""

    class Meta:
        model = WorkspaceUserPreference
        fields = ["key", "is_pinned", "sort_order"]
        read_only_fields = ["workspace", "created_by", "updated_by"]
