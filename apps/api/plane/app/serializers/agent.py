# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for agentic members (shared by the app API and the public API).

Validation keeps definitions prompt-sized and well-formed: they are served
verbatim to LLM platforms as context.
"""

# Python imports
import re
import uuid

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import (
    IssueAssignee,
    WorkspaceAgent,
    WorkspaceAgentRevision,
    WorkspaceMember,
)
from plane.db.models.agent import DEFINITION_FIELDS
from plane.utils.agents.context import MAX_CONTEXT_BYTES, build_context

HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,47}$")
MAX_MARKDOWN_CHARS = 20000
MAX_WORKFLOW_STEPS = 50
MAX_STEP_TEXT_CHARS = 5000
MAX_LIST_ITEMS = 50
MAX_HINT_KEYS = 20

MARKDOWN_FIELDS = ("profile_md", "goal_md", "how_it_works_md", "instructions_md")


def _user_lite(user):
    return {
        "id": str(user.id),
        "display_name": user.display_name,
        "first_name": user.first_name,
        "avatar_url": user.avatar_url,
        "is_bot": user.is_bot,
        "bot_type": user.bot_type,
    }


def _text(value, label, max_chars, required=False):
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise serializers.ValidationError(f"{label} must be a string")
    value = value.strip()
    if required and not value:
        raise serializers.ValidationError(f"{label} is required")
    if len(value) > max_chars:
        raise serializers.ValidationError(f"{label} must be at most {max_chars} characters")
    return value


class WorkspaceAgentSerializer(serializers.ModelSerializer):
    """Full agent definition plus membership/assignment info."""

    bot_user = serializers.SerializerMethodField()
    owner = serializers.SerializerMethodField()
    owner_id = serializers.UUIDField(required=False, allow_null=True)
    project_ids = serializers.SerializerMethodField()
    assigned_open_count = serializers.SerializerMethodField()
    # Write-only extras
    change_note = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=500)
    initial_project_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)

    class Meta:
        model = WorkspaceAgent
        fields = [
            "id",
            "workspace",
            "bot_user",
            "bot_user_id",
            "name",
            "handle",
            "role_title",
            "logo_props",
            "summary",
            "profile_md",
            "goal_md",
            "how_it_works_md",
            "instructions_md",
            "workflow",
            "capabilities",
            "tools",
            "runtime_hints",
            "status",
            "accept_assignments",
            "owner",
            "owner_id",
            "version",
            "definition_hash",
            "metadata",
            "sort_order",
            "project_ids",
            "assigned_open_count",
            "created_at",
            "updated_at",
            "change_note",
            "initial_project_ids",
        ]
        read_only_fields = [
            "id",
            "workspace",
            "bot_user",
            "bot_user_id",
            "version",
            "definition_hash",
            "created_at",
            "updated_at",
        ]

    # -- read helpers -------------------------------------------------------

    def get_bot_user(self, obj):
        return _user_lite(obj.bot_user)

    def get_owner(self, obj):
        return _user_lite(obj.owner) if obj.owner_id and obj.owner else None

    def get_project_ids(self, obj):
        from plane.utils.agents.lifecycle import agent_project_ids

        return [str(pid) for pid in agent_project_ids(obj)]

    def get_assigned_open_count(self, obj):
        return (
            IssueAssignee.objects.filter(
                assignee_id=obj.bot_user_id,
                issue__state__group__in=["backlog", "unstarted", "started"],
                issue__archived_at__isnull=True,
                issue__is_draft=False,
                issue__deleted_at__isnull=True,
            )
            .values("issue_id")
            .distinct()
            .count()
        )

    # -- field validation ---------------------------------------------------

    def validate_name(self, value):
        return _text(value, "name", 255, required=True)

    def validate_handle(self, value):
        value = (value or "").strip().lower()
        if not HANDLE_RE.match(value):
            raise serializers.ValidationError(
                "handle must be 2-48 characters: lowercase letters, digits, '-' or '_', starting with a letter or digit"
            )
        workspace_id = self.context.get("workspace_id")
        qs = WorkspaceAgent.objects.filter(workspace_id=workspace_id, handle=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("An agent with this handle already exists in the workspace")
        return value

    def validate_role_title(self, value):
        return _text(value, "role_title", 255)

    def validate_summary(self, value):
        return _text(value, "summary", 280)

    def validate_status(self, value):
        # Archive/restore go through dedicated endpoints so memberships are updated too
        current = self.instance.status if self.instance else None
        archived = WorkspaceAgent.Status.ARCHIVED
        if value == archived and current != archived:
            raise serializers.ValidationError("Use the archive endpoint to archive an agent")
        if current == archived and value != archived:
            raise serializers.ValidationError("Use the restore endpoint to restore an archived agent")
        return value

    def validate_workflow(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("workflow must be a list of steps")
        if len(value) > MAX_WORKFLOW_STEPS:
            raise serializers.ValidationError(f"workflow can have at most {MAX_WORKFLOW_STEPS} steps")
        steps = []
        for index, step in enumerate(value, start=1):
            if not isinstance(step, dict):
                raise serializers.ValidationError(f"workflow step {index} must be an object")
            steps.append(
                {
                    "id": str(step.get("id") or uuid.uuid4()),
                    "title": _text(step.get("title"), f"workflow step {index} title", 255, required=True),
                    "description_md": _text(
                        step.get("description_md"), f"workflow step {index} description_md", MAX_STEP_TEXT_CHARS
                    ),
                    "expected_output_md": _text(
                        step.get("expected_output_md"),
                        f"workflow step {index} expected_output_md",
                        MAX_STEP_TEXT_CHARS,
                    ),
                    "requires_approval": bool(step.get("requires_approval", False)),
                }
            )
        return steps

    def validate_capabilities(self, value):
        if not isinstance(value, list) or len(value) > MAX_LIST_ITEMS:
            raise serializers.ValidationError(f"capabilities must be a list of at most {MAX_LIST_ITEMS} strings")
        cleaned = []
        for item in value:
            text = _text(item, "capability", 64, required=True)
            if text not in cleaned:
                cleaned.append(text)
        return cleaned

    def validate_tools(self, value):
        if not isinstance(value, list) or len(value) > MAX_LIST_ITEMS:
            raise serializers.ValidationError(f"tools must be a list of at most {MAX_LIST_ITEMS} objects")
        tools = []
        for index, tool in enumerate(value, start=1):
            if not isinstance(tool, dict):
                raise serializers.ValidationError(f"tool {index} must be an object")
            tools.append(
                {
                    "name": _text(tool.get("name"), f"tool {index} name", 128, required=True),
                    "description": _text(tool.get("description"), f"tool {index} description", 1000),
                    "usage_md": _text(tool.get("usage_md"), f"tool {index} usage_md", MAX_STEP_TEXT_CHARS),
                }
            )
        return tools

    def validate_runtime_hints(self, value):
        if not isinstance(value, dict) or len(value) > MAX_HINT_KEYS:
            raise serializers.ValidationError(f"runtime_hints must be an object with at most {MAX_HINT_KEYS} keys")
        for key, hint in value.items():
            if not isinstance(key, str) or len(key) > 64:
                raise serializers.ValidationError("runtime_hints keys must be strings of at most 64 characters")
            if not isinstance(hint, (str, int, float, bool)) or (isinstance(hint, str) and len(hint) > 200):
                raise serializers.ValidationError(
                    f"runtime_hints.{key} must be a string (max 200 chars), number or boolean"
                )
        return value

    def validate_owner_id(self, value):
        if value is None:
            return value
        if not WorkspaceMember.objects.filter(
            workspace_id=self.context.get("workspace_id"),
            member_id=value,
            member__is_bot=False,
            is_active=True,
        ).exists():
            raise serializers.ValidationError("owner must be an active human member of the workspace")
        return value

    def validate(self, attrs):
        for field in MARKDOWN_FIELDS:
            if field in attrs:
                attrs[field] = _text(attrs[field], field, MAX_MARKDOWN_CHARS)
        # The rendered context must stay prompt-sized
        if self.instance:
            merged = self.instance.canonical_definition()
        else:
            merged = {field: "" for field in DEFINITION_FIELDS}
        merged.update({key: value for key, value in attrs.items() if key in DEFINITION_FIELDS})
        rendered = build_context(merged, {"version": getattr(self.instance, "version", 1)})
        if len(rendered.encode("utf-8")) > MAX_CONTEXT_BYTES:
            raise serializers.ValidationError(
                {"error": f"The rendered agent context exceeds {MAX_CONTEXT_BYTES // 1024} KB. Shorten the definition."}
            )
        return attrs


class WorkspaceAgentLiteSerializer(serializers.ModelSerializer):
    """Compact listing used by LLM platforms to choose an agent."""

    bot_user_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = WorkspaceAgent
        fields = [
            "id",
            "handle",
            "name",
            "role_title",
            "summary",
            "status",
            "accept_assignments",
            "version",
            "capabilities",
            "bot_user_id",
            "updated_at",
        ]
        read_only_fields = fields


class WorkspaceAgentRevisionSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkspaceAgentRevision
        fields = [
            "id",
            "version",
            "definition",
            "definition_hash",
            "change_note",
            "created_at",
            "created_by",
            "created_by_name",
        ]
        read_only_fields = fields

    def get_created_by_name(self, obj):
        return obj.created_by.display_name if obj.created_by_id and obj.created_by else None
