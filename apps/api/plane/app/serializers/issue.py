# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for issues (work items) and their related objects in the ``plane.app`` API.

Includes the issue create/update serializer (which manages assignee and label
links), list/detail read serializers, and serializers for activities,
comments, labels, links, attachments, reactions, votes, relations,
subscribers and issue/description version history.
"""

# Django imports
from django.utils import timezone
from django.core.validators import URLValidator
from django.core.exceptions import ValidationError
from django.db import IntegrityError

# Third Party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer, DynamicBaseSerializer
from .user import UserLiteSerializer
from .state import StateLiteSerializer
from .project import ProjectLiteSerializer
from .workspace import WorkspaceLiteSerializer
from plane.db.models import (
    User,
    Issue,
    IssueActivity,
    IssueComment,
    ProjectUserProperty,
    IssueAssignee,
    IssueSubscriber,
    IssueLabel,
    Label,
    CycleIssue,
    Cycle,
    Module,
    ModuleIssue,
    IssueLink,
    FileAsset,
    IssueReaction,
    CommentReaction,
    IssueVote,
    IssueRelation,
    State,
    IssueVersion,
    IssueDescriptionVersion,
    ProjectMember,
    EstimatePoint,
)
from plane.utils.content_validator import (
    validate_html_content,
    validate_binary_data,
)


class IssueFlatSerializer(BaseSerializer):
    """Issue with only its own scalar fields (no nested relations)."""
    ## Contain only flat fields

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "description_json",
            "description_html",
            "priority",
            "start_date",
            "target_date",
            "sequence_id",
            "sort_order",
            "is_draft",
        ]


class IssueProjectLiteSerializer(BaseSerializer):
    """Minimal issue representation with nested project details."""

    project_detail = ProjectLiteSerializer(source="project", read_only=True)

    class Meta:
        model = Issue
        fields = ["id", "project_detail", "name", "sequence_id"]
        read_only_fields = fields


##TODO: Find a better way to write this serializer
## Find a better approach to save manytomany?
class IssueCreateSerializer(BaseSerializer):
    """Create/update serializer for issues.

    Validates that state, parent, estimate point, assignees and labels belong to
    ``context["project_id"]``, sanitizes description content and manages the
    IssueAssignee/IssueLabel link rows. Context must include ``project_id``,
    ``workspace_id`` and ``default_assignee_id`` on create; set
    ``allow_triage_state`` to accept intake triage states.
    """

    # ids
    state_id = serializers.PrimaryKeyRelatedField(
        source="state", queryset=State.all_state_objects.all(), required=False, allow_null=True
    )
    parent_id = serializers.PrimaryKeyRelatedField(
        source="parent", queryset=Issue.objects.all(), required=False, allow_null=True
    )
    label_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=Label.objects.all()),
        write_only=True,
        required=False,
    )
    assignee_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )
    project_id = serializers.UUIDField(source="project.id", read_only=True)
    workspace_id = serializers.UUIDField(source="workspace.id", read_only=True)

    class Meta:
        model = Issue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "completed_at",
        ]

    def to_representation(self, instance):
        """Echo back the submitted ``assignee_ids``/``label_ids`` from the raw request data."""
        data = super().to_representation(instance)
        assignee_ids = self.initial_data.get("assignee_ids")
        data["assignee_ids"] = assignee_ids if assignee_ids else []
        label_ids = self.initial_data.get("label_ids")
        data["label_ids"] = label_ids if label_ids else []
        return data

    def validate(self, attrs):
        """Validate dates, sanitize description content and scope related ids to the project."""
        allow_triage = self.context.get("allow_triage_state", False)
        state_manager = State.triage_objects if allow_triage else State.objects

        if (
            attrs.get("start_date", None) is not None
            and attrs.get("target_date", None) is not None
            and attrs.get("start_date", None) > attrs.get("target_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed target date")

        # Validate description content for security
        if "description_html" in attrs and attrs["description_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(attrs["description_html"])
            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})
            # Update the attrs with sanitized HTML if available
            if sanitized_html is not None:
                attrs["description_html"] = sanitized_html

        if "description_binary" in attrs and attrs["description_binary"]:
            is_valid, error_msg = validate_binary_data(attrs["description_binary"])
            if not is_valid:
                raise serializers.ValidationError({"description_binary": "Invalid binary data"})

        # Validate assignees are from project
        # Silently drop assignees who are not active project members with role >= MEMBER (15)
        if attrs.get("assignee_ids", []):
            attrs["assignee_ids"] = ProjectMember.objects.filter(
                project_id=self.context["project_id"],
                role__gte=15,
                is_active=True,
                member_id__in=attrs["assignee_ids"],
            ).values_list("member_id", flat=True)

        # Validate labels are from project
        # Silently drop labels that don't belong to the project
        if attrs.get("label_ids"):
            label_ids = [label.id for label in attrs["label_ids"]]
            attrs["label_ids"] = list(
                Label.objects.filter(
                    project_id=self.context.get("project_id"),
                    id__in=label_ids,
                ).values_list("id", flat=True)
            )

        # Check state is from the project only else raise validation error
        if (
            attrs.get("state")
            and not state_manager.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("state").id,
            ).exists()
        ):
            raise serializers.ValidationError("State is not valid please pass a valid state_id")

        # Check parent issue is from workspace as it can be cross workspace
        if (
            attrs.get("parent")
            and not Issue.objects.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("parent").id,
            ).exists()
        ):
            raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")

        if (
            attrs.get("estimate_point")
            and not EstimatePoint.objects.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("estimate_point").id,
            ).exists()
        ):
            raise serializers.ValidationError("Estimate point is not valid please pass a valid estimate_point_id")

        return attrs

    def create(self, validated_data):
        """Create the issue plus its assignee and label links.

        When no assignees are given, falls back to the project's default assignee
        if they are an active member with role >= MEMBER. Duplicate-link
        IntegrityErrors are ignored.
        """
        assignees = validated_data.pop("assignee_ids", None)
        labels = validated_data.pop("label_ids", None)

        project_id = self.context["project_id"]
        workspace_id = self.context["workspace_id"]
        default_assignee_id = self.context["default_assignee_id"]

        # Create Issue
        issue = Issue.objects.create(**validated_data, project_id=project_id)

        # Issue Audit Users
        created_by_id = issue.created_by_id
        updated_by_id = issue.updated_by_id

        if assignees is not None and len(assignees):
            try:
                IssueAssignee.objects.bulk_create(
                    [
                        IssueAssignee(
                            assignee_id=assignee_id,
                            issue=issue,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for assignee_id in assignees
                    ],
                    batch_size=10,
                )
            except IntegrityError:
                pass
        else:
            # Then assign it to default assignee, if it is a valid assignee
            if (
                default_assignee_id is not None
                and ProjectMember.objects.filter(
                    member_id=default_assignee_id,
                    project_id=project_id,
                    role__gte=15,
                    is_active=True,
                ).exists()
            ):
                try:
                    IssueAssignee.objects.create(
                        assignee_id=default_assignee_id,
                        issue=issue,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                except IntegrityError:
                    pass

        if labels is not None and len(labels):
            try:
                IssueLabel.objects.bulk_create(
                    [
                        IssueLabel(
                            label_id=label_id,
                            issue=issue,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for label_id in labels
                    ],
                    batch_size=10,
                )
            except IntegrityError:
                pass

        return issue

    def update(self, instance, validated_data):
        """Update the issue; ``assignee_ids``/``label_ids`` when provided fully replace the existing links."""
        assignees = validated_data.pop("assignee_ids", None)
        labels = validated_data.pop("label_ids", None)

        # Related models
        project_id = instance.project_id
        workspace_id = instance.workspace_id
        created_by_id = instance.created_by_id
        updated_by_id = instance.updated_by_id

        if assignees is not None:
            IssueAssignee.objects.filter(issue=instance).delete()
            try:
                IssueAssignee.objects.bulk_create(
                    [
                        IssueAssignee(
                            assignee_id=assignee_id,
                            issue=instance,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for assignee_id in assignees
                    ],
                    batch_size=10,
                    ignore_conflicts=True,
                )
            except IntegrityError:
                pass

        if labels is not None:
            IssueLabel.objects.filter(issue=instance).delete()
            try:
                IssueLabel.objects.bulk_create(
                    [
                        IssueLabel(
                            label_id=label_id,
                            issue=instance,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for label_id in labels
                    ],
                    batch_size=10,
                    ignore_conflicts=True,
                )
            except IntegrityError:
                pass

        # Time updation occues even when other related models are updated
        instance.updated_at = timezone.now()
        return super().update(instance, validated_data)


class IssueActivitySerializer(BaseSerializer):
    """Issue activity log entry with actor/issue/project/workspace details and optional intake source info."""

    actor_detail = UserLiteSerializer(read_only=True, source="actor")
    issue_detail = IssueFlatSerializer(read_only=True, source="issue")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")
    source_data = serializers.SerializerMethodField()

    def get_source_data(self, obj):
        """Return intake source info (source, email, extra) when the view prefetched ``issue.source_data``."""
        if hasattr(obj, "issue") and hasattr(obj.issue, "source_data") and obj.issue.source_data:
            return {
                "source": obj.issue.source_data[0].source,
                "source_email": obj.issue.source_data[0].source_email,
                "extra": obj.issue.source_data[0].extra,
            }
        return None

    class Meta:
        model = IssueActivity
        fields = "__all__"


class ProjectUserPropertySerializer(BaseSerializer):
    """Per-user, per-project display preferences (filters, display properties)."""

    class Meta:
        model = ProjectUserProperty
        fields = "__all__"
        read_only_fields = ["user", "workspace", "project"]


class LabelSerializer(BaseSerializer):
    """Project label; label names must be unique (case-insensitive) within a project."""

    class Meta:
        model = Label
        fields = [
            "parent",
            "name",
            "color",
            "id",
            "project_id",
            "workspace_id",
            "sort_order",
        ]
        read_only_fields = ["workspace", "project"]

    def validate_name(self, value):
        """Reject a name that already exists (case-insensitive) in ``context["project_id"]``, excluding self."""
        project_id = self.context.get("project_id")

        label = Label.objects.filter(project_id=project_id, name__iexact=value)

        if self.instance:
            label = label.exclude(id=self.instance.pk)

        if label.exists():
            raise serializers.ValidationError(detail="LABEL_NAME_ALREADY_EXISTS")

        return value


class LabelLiteSerializer(BaseSerializer):
    """Minimal label representation (id, name, color)."""

    class Meta:
        model = Label
        fields = ["id", "name", "color"]


class IssueLabelSerializer(BaseSerializer):
    """Issue-label link row."""

    class Meta:
        model = IssueLabel
        fields = "__all__"
        read_only_fields = ["workspace", "project"]


class IssueRelationSerializer(BaseSerializer):
    """Outgoing relation of an issue, flattened to the *related* issue's fields plus ``relation_type``."""

    id = serializers.UUIDField(source="related_issue.id", read_only=True)
    project_id = serializers.PrimaryKeyRelatedField(source="related_issue.project_id", read_only=True)
    sequence_id = serializers.IntegerField(source="related_issue.sequence_id", read_only=True)
    name = serializers.CharField(source="related_issue.name", read_only=True)
    relation_type = serializers.CharField(read_only=True)
    state_id = serializers.UUIDField(source="related_issue.state.id", read_only=True)
    priority = serializers.CharField(source="related_issue.priority", read_only=True)
    assignee_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )

    class Meta:
        model = IssueRelation
        fields = [
            "id",
            "project_id",
            "sequence_id",
            "relation_type",
            "name",
            "state_id",
            "priority",
            "assignee_ids",
            "created_by",
            "created_at",
            "updated_at",
            "updated_by",
        ]
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        ]


class RelatedIssueSerializer(BaseSerializer):
    """Incoming relation of an issue, flattened to the *source* issue's fields plus ``relation_type``."""

    id = serializers.UUIDField(source="issue.id", read_only=True)
    project_id = serializers.PrimaryKeyRelatedField(source="issue.project_id", read_only=True)
    sequence_id = serializers.IntegerField(source="issue.sequence_id", read_only=True)
    name = serializers.CharField(source="issue.name", read_only=True)
    relation_type = serializers.CharField(read_only=True)
    state_id = serializers.UUIDField(source="issue.state.id", read_only=True)
    priority = serializers.CharField(source="issue.priority", read_only=True)
    assignee_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )

    class Meta:
        model = IssueRelation
        fields = [
            "id",
            "project_id",
            "sequence_id",
            "relation_type",
            "name",
            "state_id",
            "priority",
            "assignee_ids",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        ]
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        ]


class IssueAssigneeSerializer(BaseSerializer):
    """Issue-assignee link row with the assignee's user details."""

    assignee_details = UserLiteSerializer(read_only=True, source="assignee")

    class Meta:
        model = IssueAssignee
        fields = "__all__"


class CycleBaseSerializer(BaseSerializer):
    """Plain cycle serializer used when nesting cycle details under issues."""

    class Meta:
        model = Cycle
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class IssueCycleDetailSerializer(BaseSerializer):
    """Cycle-issue link with nested cycle details."""

    cycle_detail = CycleBaseSerializer(read_only=True, source="cycle")

    class Meta:
        model = CycleIssue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class ModuleBaseSerializer(BaseSerializer):
    """Plain module serializer used when nesting module details under issues."""

    class Meta:
        model = Module
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class IssueModuleDetailSerializer(BaseSerializer):
    """Module-issue link with nested module details."""

    module_detail = ModuleBaseSerializer(read_only=True, source="module")

    class Meta:
        model = ModuleIssue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class IssueLinkSerializer(BaseSerializer):
    """External link attached to an issue; URLs are normalized and must be unique per issue."""

    created_by_detail = UserLiteSerializer(read_only=True, source="created_by")

    class Meta:
        model = IssueLink
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "issue",
        ]

    def to_internal_value(self, data):
        """Prefix ``http://`` to URLs without a scheme before field validation."""
        # Modify the URL before validation by appending http:// if missing
        url = data.get("url", "")
        if url and not url.startswith(("http://", "https://")):
            data["url"] = "http://" + url

        return super().to_internal_value(data)

    def validate_url(self, value):
        """Validate URL syntax with Django's URLValidator."""
        # Use Django's built-in URLValidator for validation
        url_validator = URLValidator()
        try:
            url_validator(value)
        except ValidationError:
            raise serializers.ValidationError({"error": "Invalid URL format."})

        return value

    # Validation if url already exists
    def create(self, validated_data):
        """Create the link, rejecting a URL that already exists on the same issue."""
        if IssueLink.objects.filter(url=validated_data.get("url"), issue_id=validated_data.get("issue_id")).exists():
            raise serializers.ValidationError({"error": "URL already exists for this Issue"})
        return IssueLink.objects.create(**validated_data)

    def update(self, instance, validated_data):
        """Update the link, rejecting a URL that already exists on another link of the same issue."""
        if (
            IssueLink.objects.filter(url=validated_data.get("url"), issue_id=instance.issue_id)
            .exclude(pk=instance.id)
            .exists()
        ):
            raise serializers.ValidationError({"error": "URL already exists for this Issue"})

        return super().update(instance, validated_data)


class IssueLinkLiteSerializer(BaseSerializer):
    """Minimal read-only issue link representation."""

    class Meta:
        model = IssueLink
        fields = [
            "id",
            "issue_id",
            "title",
            "url",
            "metadata",
            "created_by_id",
            "created_at",
        ]
        read_only_fields = fields


class IssueAttachmentSerializer(BaseSerializer):
    """Issue attachment (FileAsset) with the computed ``asset_url``."""

    asset_url = serializers.CharField(read_only=True)

    class Meta:
        model = FileAsset
        fields = "__all__"
        read_only_fields = [
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "workspace",
            "project",
            "issue",
        ]


class IssueAttachmentLiteSerializer(DynamicBaseSerializer):
    """Minimal read-only attachment representation used for expansion/nesting."""

    class Meta:
        model = FileAsset
        fields = [
            "id",
            "asset",
            "attributes",
            # "issue_id",
            "created_by",
            "updated_at",
            "updated_by",
            "asset_url",
        ]
        read_only_fields = fields


class IssueReactionSerializer(BaseSerializer):
    """Emoji reaction on an issue with the actor's details."""

    actor_detail = UserLiteSerializer(read_only=True, source="actor")

    class Meta:
        model = IssueReaction
        fields = "__all__"
        read_only_fields = ["workspace", "project", "issue", "actor", "deleted_at"]


class IssueReactionLiteSerializer(DynamicBaseSerializer):
    """Minimal issue reaction with the actor's display name."""

    display_name = serializers.CharField(source="actor.display_name", read_only=True)

    class Meta:
        model = IssueReaction
        fields = ["id", "actor", "issue", "reaction", "display_name"]


class CommentReactionSerializer(BaseSerializer):
    """Emoji reaction on a comment with the actor's display name."""

    display_name = serializers.CharField(source="actor.display_name", read_only=True)

    class Meta:
        model = CommentReaction
        fields = [
            "id",
            "actor",
            "comment",
            "reaction",
            "display_name",
            "deleted_at",
            "workspace",
            "project",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = ["workspace", "project", "comment", "actor", "deleted_at", "created_by", "updated_by"]


class IssueVoteSerializer(BaseSerializer):
    """Read-only vote on an issue (used by the public/deploy board)."""

    actor_detail = UserLiteSerializer(read_only=True, source="actor")

    class Meta:
        model = IssueVote
        fields = ["issue", "vote", "workspace", "project", "actor", "actor_detail"]
        read_only_fields = fields


class IssueCommentSerializer(BaseSerializer):
    """Issue comment with actor/issue/project details and reactions; comment HTML is sanitized."""

    actor_detail = UserLiteSerializer(read_only=True, source="actor")
    issue_detail = IssueFlatSerializer(read_only=True, source="issue")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")
    comment_reactions = CommentReactionSerializer(read_only=True, many=True)
    is_member = serializers.BooleanField(read_only=True)

    class Meta:
        model = IssueComment
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "issue",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        """Sanitize ``comment_html`` and reject invalid HTML."""
        if "comment_html" in attrs and attrs["comment_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(attrs["comment_html"])
            if not is_valid:
                raise serializers.ValidationError({"comment_html": "HTML content is not valid"})
            if sanitized_html is not None:
                attrs["comment_html"] = sanitized_html
        return attrs


class IssueStateFlatSerializer(BaseSerializer):
    """Minimal issue with state and project details."""

    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")

    class Meta:
        model = Issue
        fields = ["id", "sequence_id", "name", "state_detail", "project_detail"]


# Issue Serializer with state details
class IssueStateSerializer(DynamicBaseSerializer):
    """Full issue model with nested label/state/project/assignee details and annotated counts."""

    label_details = LabelLiteSerializer(read_only=True, source="labels", many=True)
    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    assignee_details = UserLiteSerializer(read_only=True, source="assignees", many=True)
    sub_issues_count = serializers.IntegerField(read_only=True)
    attachment_count = serializers.IntegerField(read_only=True)
    link_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Issue
        fields = "__all__"


class IssueIntakeSerializer(DynamicBaseSerializer):
    """Minimal issue representation used for intake listings."""

    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "priority",
            "sequence_id",
            "project_id",
            "created_at",
            "label_ids",
            "created_by",
        ]
        read_only_fields = fields


class IssueSerializer(DynamicBaseSerializer):
    """Read-only list representation of an issue using ids for relations.

    Relation ids and counts (``cycle_id``, ``module_ids``, ``label_ids``,
    ``assignee_ids``, ``*_count``) are expected to be annotated by the view.
    """

    # ids
    cycle_id = serializers.PrimaryKeyRelatedField(read_only=True)
    module_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    # Many to many
    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    assignee_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    # Count items
    sub_issues_count = serializers.IntegerField(read_only=True)
    attachment_count = serializers.IntegerField(read_only=True)
    link_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "state_id",
            "sort_order",
            "completed_at",
            "estimate_point",
            "priority",
            "start_date",
            "target_date",
            "sequence_id",
            "project_id",
            "parent_id",
            "cycle_id",
            "module_ids",
            "label_ids",
            "assignee_ids",
            "sub_issues_count",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "attachment_count",
            "link_count",
            "is_draft",
            "archived_at",
        ]
        read_only_fields = fields

    def validate(self, data):
        """Ensure a provided ``state_id`` belongs to ``context["project_id"]``."""
        if (
            data.get("state_id")
            and not State.objects.filter(project_id=self.context.get("project_id"), pk=data.get("state_id")).exists()
        ):
            raise serializers.ValidationError("State is not valid please pass a valid state_id")
        return data


class IssueListDetailSerializer(serializers.Serializer):
    """Hand-written, fast list serializer for issues (avoids DRF field machinery).

    Reads relations from prefetched ``issue_module``/``label_issue``/``issue_assignee``
    and expects ``cycle_id`` and ``*_count`` to be annotated. Supports
    ``expand=["issue_relation", "issue_related"]``.
    """

    def __init__(self, *args, **kwargs):
        # Extract expand parameter and store it as instance variable
        self.expand = kwargs.pop("expand", []) or []
        # Extract fields parameter and store it as instance variable
        self.fields = kwargs.pop("fields", []) or []
        super().__init__(*args, **kwargs)

    def get_module_ids(self, obj):
        """Module ids from the prefetched ``issue_module`` relation."""
        return [module.module_id for module in obj.issue_module.all()]

    def get_label_ids(self, obj):
        """Label ids from the prefetched ``label_issue`` relation."""
        return [label.label_id for label in obj.label_issue.all()]

    def get_assignee_ids(self, obj):
        """Assignee ids from the prefetched ``issue_assignee`` relation."""
        return [assignee.assignee_id for assignee in obj.issue_assignee.all()]

    def to_representation(self, instance):
        """Build the issue dict directly from model attributes, adding expanded relations if requested."""
        data = {
            # Basic fields
            "id": instance.id,
            "name": instance.name,
            "state_id": instance.state_id,
            "sort_order": instance.sort_order,
            "completed_at": instance.completed_at,
            "estimate_point": instance.estimate_point_id,
            "priority": instance.priority,
            "start_date": instance.start_date,
            "target_date": instance.target_date,
            "sequence_id": instance.sequence_id,
            "project_id": instance.project_id,
            "parent_id": instance.parent_id,
            "created_at": instance.created_at,
            "updated_at": instance.updated_at,
            "created_by": instance.created_by_id,
            "updated_by": instance.updated_by_id,
            "is_draft": instance.is_draft,
            "archived_at": instance.archived_at,
            # Computed fields
            "cycle_id": instance.cycle_id,
            "module_ids": self.get_module_ids(instance),
            "label_ids": self.get_label_ids(instance),
            "assignee_ids": self.get_assignee_ids(instance),
            "sub_issues_count": instance.sub_issues_count,
            "attachment_count": instance.attachment_count,
            "link_count": instance.link_count,
        }

        # Handle expanded fields only when requested - using direct field access
        if self.expand:
            if "issue_relation" in self.expand:
                relations = []
                for relation in instance.issue_relation.all():
                    related_issue = relation.related_issue
                    # If the related issue is deleted, skip it
                    if not related_issue:
                        continue
                    # Add the related issue to the relations list
                    relations.append(
                        {
                            "id": related_issue.id,
                            "project_id": related_issue.project_id,
                            "sequence_id": related_issue.sequence_id,
                            "name": related_issue.name,
                            "relation_type": relation.relation_type,
                            "state_id": related_issue.state_id,
                            "priority": related_issue.priority,
                            "created_by": related_issue.created_by_id,
                            "created_at": related_issue.created_at,
                            "updated_at": related_issue.updated_at,
                            "updated_by": related_issue.updated_by_id,
                        }
                    )
                data["issue_relation"] = relations

            if "issue_related" in self.expand:
                related = []
                for relation in instance.issue_related.all():
                    issue = relation.issue
                    # If the related issue is deleted, skip it
                    if not issue:
                        continue
                    # Add the related issue to the related list
                    related.append(
                        {
                            "id": issue.id,
                            "project_id": issue.project_id,
                            "sequence_id": issue.sequence_id,
                            "name": issue.name,
                            "relation_type": relation.relation_type,
                            "state_id": issue.state_id,
                            "priority": issue.priority,
                            "created_by": issue.created_by_id,
                            "created_at": issue.created_at,
                            "updated_at": issue.updated_at,
                            "updated_by": issue.updated_by_id,
                        }
                    )
                data["issue_related"] = related

        return data


class IssueLiteSerializer(DynamicBaseSerializer):
    """Minimal issue reference (id, sequence_id, project_id)."""

    class Meta:
        model = Issue
        fields = ["id", "sequence_id", "project_id"]
        read_only_fields = fields


class IssueDetailSerializer(IssueSerializer):
    """Issue detail: the list representation plus description HTML, subscription and intake flags."""

    description_html = serializers.CharField()
    is_subscribed = serializers.BooleanField(read_only=True)
    is_intake = serializers.BooleanField(read_only=True)

    class Meta(IssueSerializer.Meta):
        fields = IssueSerializer.Meta.fields + [
            "description_html",
            "is_subscribed",
            "is_intake",
        ]
        read_only_fields = fields


class IssuePublicSerializer(BaseSerializer):
    """Issue representation for public (deploy board) views, with reactions and votes."""

    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    state_detail = StateLiteSerializer(read_only=True, source="state")
    reactions = IssueReactionSerializer(read_only=True, many=True, source="issue_reactions")
    votes = IssueVoteSerializer(read_only=True, many=True)

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "description_html",
            "sequence_id",
            "state",
            "state_detail",
            "project",
            "project_detail",
            "workspace",
            "priority",
            "target_date",
            "reactions",
            "votes",
        ]
        read_only_fields = fields


class IssueSubscriberSerializer(BaseSerializer):
    """Issue subscriber (user who receives notifications for the issue)."""

    class Meta:
        model = IssueSubscriber
        fields = "__all__"
        read_only_fields = ["workspace", "project", "issue"]


class IssueVersionDetailSerializer(BaseSerializer):
    """Snapshot of an issue's properties at a point in time (issue version history)."""

    class Meta:
        model = IssueVersion
        fields = [
            "id",
            "workspace",
            "project",
            "issue",
            "parent",
            "state",
            "estimate_point",
            "name",
            "priority",
            "start_date",
            "target_date",
            "assignees",
            "sequence_id",
            "labels",
            "sort_order",
            "completed_at",
            "archived_at",
            "is_draft",
            "external_source",
            "external_id",
            "type",
            "cycle",
            "modules",
            "meta",
            "name",
            "last_saved_at",
            "owned_by",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = ["workspace", "project", "issue"]


class IssueDescriptionVersionDetailSerializer(BaseSerializer):
    """Snapshot of an issue's description at a point in time (description version history)."""

    class Meta:
        model = IssueDescriptionVersion
        fields = [
            "id",
            "workspace",
            "project",
            "issue",
            "description_binary",
            "description_html",
            "description_stripped",
            "description_json",
            "last_saved_at",
            "owned_by",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = ["workspace", "project", "issue"]
