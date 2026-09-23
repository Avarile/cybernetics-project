# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Issue-related serializers for the public (space) API.

Used by published project boards to show issues, their relations, comments, reactions and
votes, and to create issues/comments from the public board.
"""

# Django imports
from django.utils import timezone

# Third Party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from .user import UserLiteSerializer
from .state import StateSerializer, StateLiteSerializer
from .project import ProjectLiteSerializer
from .cycle import CycleBaseSerializer
from .module import ModuleBaseSerializer
from .workspace import WorkspaceLiteSerializer
from plane.db.models import (
    User,
    Issue,
    IssueComment,
    IssueAssignee,
    IssueLabel,
    Label,
    CycleIssue,
    ModuleIssue,
    IssueLink,
    FileAsset,
    IssueReaction,
    CommentReaction,
    IssueVote,
    IssueRelation,
)
from plane.utils.content_validator import (
    validate_html_content,
    validate_binary_data,
)


class IssueStateFlatSerializer(BaseSerializer):
    """Issue id/sequence/name with lite state and project details (e.g. for a parent issue)."""

    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")

    class Meta:
        model = Issue
        fields = ["id", "sequence_id", "name", "state_detail", "project_detail"]


class LabelSerializer(BaseSerializer):
    """Full label with nested workspace and project details."""

    workspace_detail = WorkspaceLiteSerializer(source="workspace", read_only=True)
    project_detail = ProjectLiteSerializer(source="project", read_only=True)

    class Meta:
        model = Label
        fields = "__all__"
        read_only_fields = ["workspace", "project"]


class IssueProjectLiteSerializer(BaseSerializer):
    """Read-only issue id/name/sequence with its project details."""

    project_detail = ProjectLiteSerializer(source="project", read_only=True)

    class Meta:
        model = Issue
        fields = ["id", "project_detail", "name", "sequence_id"]
        read_only_fields = fields


class IssueRelationSerializer(BaseSerializer):
    """Relation seen from the source issue: ``issue_detail`` describes the related issue."""

    issue_detail = IssueProjectLiteSerializer(read_only=True, source="related_issue")

    class Meta:
        model = IssueRelation
        fields = ["issue_detail", "relation_type", "related_issue", "issue", "id"]
        read_only_fields = ["workspace", "project"]


class RelatedIssueSerializer(BaseSerializer):
    """Reverse relation: ``issue_detail`` describes the issue that points at this one."""

    issue_detail = IssueProjectLiteSerializer(read_only=True, source="issue")

    class Meta:
        model = IssueRelation
        fields = ["issue_detail", "relation_type", "related_issue", "issue", "id"]
        read_only_fields = ["workspace", "project"]


class IssueCycleDetailSerializer(BaseSerializer):
    """CycleIssue link with nested cycle details."""

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


class IssueModuleDetailSerializer(BaseSerializer):
    """ModuleIssue link with nested module details."""

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
    """External link attached to an issue, with creator details."""

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

    # Validation if url already exists
    def create(self, validated_data):
        """Create the link, rejecting a URL already linked to the same issue."""
        if IssueLink.objects.filter(url=validated_data.get("url"), issue_id=validated_data.get("issue_id")).exists():
            raise serializers.ValidationError({"error": "URL already exists for this Issue"})
        return IssueLink.objects.create(**validated_data)


class IssueAttachmentSerializer(BaseSerializer):
    """File asset attached to an issue."""

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


class IssueReactionSerializer(BaseSerializer):
    """Emoji reaction on an issue (actor and issue are set by the view)."""

    class Meta:
        model = IssueReaction
        fields = ["issue", "reaction", "workspace", "project", "actor"]
        read_only_fields = ["workspace", "project", "issue", "actor"]


class IssueSerializer(BaseSerializer):
    """Detailed issue with nested state, labels, assignees, relations, cycle/module, links, attachments and reactions."""

    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    state_detail = StateSerializer(read_only=True, source="state")
    parent_detail = IssueStateFlatSerializer(read_only=True, source="parent")
    label_details = LabelSerializer(read_only=True, source="labels", many=True)
    assignee_details = UserLiteSerializer(read_only=True, source="assignees", many=True)
    related_issues = IssueRelationSerializer(read_only=True, source="issue_relation", many=True)
    issue_relations = RelatedIssueSerializer(read_only=True, source="issue_related", many=True)
    issue_cycle = IssueCycleDetailSerializer(read_only=True)
    issue_module = IssueModuleDetailSerializer(read_only=True)
    issue_link = IssueLinkSerializer(read_only=True, many=True)
    issue_attachment = IssueAttachmentSerializer(read_only=True, many=True)
    sub_issues_count = serializers.IntegerField(read_only=True)
    issue_reactions = IssueReactionSerializer(read_only=True, many=True)

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
        ]


class IssueFlatSerializer(BaseSerializer):
    """Issue scalar fields only (no nested relations)."""

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


class CommentReactionLiteSerializer(BaseSerializer):
    """Reaction on a comment with actor details."""

    actor_detail = UserLiteSerializer(read_only=True, source="actor")

    class Meta:
        model = CommentReaction
        fields = ["id", "reaction", "comment", "actor_detail"]


class IssueCommentSerializer(BaseSerializer):
    """Issue comment with actor, issue, project, workspace details and reactions.

    ``is_member`` is expected as a queryset annotation.
    """

    actor_detail = UserLiteSerializer(read_only=True, source="actor")
    issue_detail = IssueFlatSerializer(read_only=True, source="issue")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")
    comment_reactions = CommentReactionLiteSerializer(read_only=True, many=True)
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


##TODO: Find a better way to write this serializer
## Find a better approach to save manytomany?
class IssueCreateSerializer(BaseSerializer):
    """Create/update an issue together with its assignees and labels (write-only id lists).

    ``create`` needs ``project_id``, ``workspace_id`` and ``default_assignee_id`` in the serializer context.
    """

    state_detail = StateSerializer(read_only=True, source="state")
    created_by_detail = UserLiteSerializer(read_only=True, source="created_by")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")

    assignees = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )

    labels = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=Label.objects.all()),
        write_only=True,
        required=False,
    )

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
        ]

    def to_representation(self, instance):
        """Add ``assignees`` and ``labels`` to the output as lists of id strings."""
        data = super().to_representation(instance)
        data["assignees"] = [str(assignee.id) for assignee in instance.assignees.all()]
        data["labels"] = [str(label.id) for label in instance.labels.all()]
        return data

    def validate(self, data):
        """Ensure start_date <= target_date and validate rich-text content.

        ``description_html`` is sanitized (replaced by the cleaned HTML); invalid HTML or
        ``description_binary`` raises a ValidationError.
        """
        if (
            data.get("start_date", None) is not None
            and data.get("target_date", None) is not None
            and data.get("start_date", None) > data.get("target_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed target date")

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

    def create(self, validated_data):
        """Create the issue in the context project, then attach assignees and labels.

        If no assignees are given, the project's default assignee (if any) is assigned.
        """
        assignees = validated_data.pop("assignees", None)
        labels = validated_data.pop("labels", None)

        project_id = self.context["project_id"]
        workspace_id = self.context["workspace_id"]
        default_assignee_id = self.context["default_assignee_id"]

        issue = Issue.objects.create(**validated_data, project_id=project_id)

        # Issue Audit Users
        created_by_id = issue.created_by_id
        updated_by_id = issue.updated_by_id

        if assignees is not None and len(assignees):
            IssueAssignee.objects.bulk_create(
                [
                    IssueAssignee(
                        assignee=user,
                        issue=issue,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for user in assignees
                ],
                batch_size=10,
            )
        else:
            # Then assign it to default assignee
            if default_assignee_id is not None:
                IssueAssignee.objects.create(
                    assignee_id=default_assignee_id,
                    issue=issue,
                    project_id=project_id,
                    workspace_id=workspace_id,
                    created_by_id=created_by_id,
                    updated_by_id=updated_by_id,
                )

        if labels is not None and len(labels):
            IssueLabel.objects.bulk_create(
                [
                    IssueLabel(
                        label=label,
                        issue=issue,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for label in labels
                ],
                batch_size=10,
            )

        return issue

    def update(self, instance, validated_data):
        """Update the issue; when ``assignees``/``labels`` are provided they replace the existing
        sets (old rows deleted, new ones bulk-created). Always bumps ``updated_at``.
        """
        assignees = validated_data.pop("assignees", None)
        labels = validated_data.pop("labels", None)

        # Related models
        project_id = instance.project_id
        workspace_id = instance.workspace_id
        created_by_id = instance.created_by_id
        updated_by_id = instance.updated_by_id

        if assignees is not None:
            IssueAssignee.objects.filter(issue=instance).delete()
            IssueAssignee.objects.bulk_create(
                [
                    IssueAssignee(
                        assignee=user,
                        issue=instance,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for user in assignees
                ],
                batch_size=10,
            )

        if labels is not None:
            IssueLabel.objects.filter(issue=instance).delete()
            IssueLabel.objects.bulk_create(
                [
                    IssueLabel(
                        label=label,
                        issue=instance,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for label in labels
                ],
                batch_size=10,
            )

        # Time updation occues even when other related models are updated
        instance.updated_at = timezone.now()
        return super().update(instance, validated_data)


class CommentReactionSerializer(BaseSerializer):
    """Full CommentReaction; comment and actor are set by the view."""

    class Meta:
        model = CommentReaction
        fields = "__all__"
        read_only_fields = ["workspace", "project", "comment", "actor"]


class IssueVoteSerializer(BaseSerializer):
    """Read-only vote on an issue."""

    class Meta:
        model = IssueVote
        fields = ["issue", "vote", "workspace", "project", "actor"]
        read_only_fields = fields


class IssuePublicSerializer(BaseSerializer):
    """Compact read-only issue for published board listings, with reactions and votes.

    ``module_ids``, ``label_ids`` and ``assignee_ids`` are expected as queryset annotations.
    """

    reactions = IssueReactionSerializer(read_only=True, many=True, source="issue_reactions")
    votes = IssueVoteSerializer(read_only=True, many=True)
    module_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    assignee_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "sequence_id",
            "state",
            "project",
            "workspace",
            "priority",
            "target_date",
            "reactions",
            "votes",
            "module_ids",
            "created_by",
            "label_ids",
            "assignee_ids",
        ]
        read_only_fields = fields


class LabelLiteSerializer(BaseSerializer):
    """Minimal label info (id, name, color)."""

    class Meta:
        model = Label
        fields = ["id", "name", "color"]
