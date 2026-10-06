# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Agentic members: AI agent definitions that live in a workspace.

Each ``WorkspaceAgent`` is backed by a bot ``User`` (``bot_type="AGENT"``) so it
can be assigned work items like any member. Its definition (profile, goal, how it
works, instructions, workflow) is served to LLM platforms through the REST API and
MCP; every definition change bumps ``version`` and is snapshotted as a
``WorkspaceAgentRevision``.
"""

# Python imports
import hashlib
import json

# Django imports
from django.conf import settings
from django.db import models
from django.db.models import Q

# Module imports
from .base import BaseModel

# Fields that make up an agent's definition. Changing any of them bumps the version;
# operational fields (status, accept_assignments, sort_order, ...) do not.
DEFINITION_FIELDS = (
    "name",
    "handle",
    "role_title",
    "summary",
    "profile_md",
    "goal_md",
    "how_it_works_md",
    "instructions_md",
    "workflow",
    "capabilities",
    "tools",
    "runtime_hints",
)


def definition_hash(definition):
    """Return the sha256 hex digest of a canonical (sorted-key) JSON definition."""
    payload = json.dumps(definition, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class WorkspaceAgent(BaseModel):
    """An agentic member of a workspace and its LLM-facing definition."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        ARCHIVED = "archived", "Archived"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="agents")
    bot_user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="agent_profile")

    # Identity
    name = models.CharField(max_length=255)
    handle = models.CharField(max_length=48)
    role_title = models.CharField(max_length=255, blank=True, default="")
    logo_props = models.JSONField(default=dict, blank=True)
    summary = models.CharField(max_length=280, blank=True, default="")

    # LLM-facing definition, stored as Markdown
    profile_md = models.TextField(blank=True, default="")
    goal_md = models.TextField(blank=True, default="")
    how_it_works_md = models.TextField(blank=True, default="")
    instructions_md = models.TextField(blank=True, default="")
    # [{id, title, description_md, expected_output_md, requires_approval}]
    workflow = models.JSONField(default=list, blank=True)
    capabilities = models.JSONField(default=list, blank=True)
    # [{name, description, usage_md}] -- descriptive only, never secrets
    tools = models.JSONField(default=list, blank=True)
    # Advisory hints for the consuming platform (model, temperature, ...)
    runtime_hints = models.JSONField(default=dict, blank=True)

    # Operational state
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    accept_assignments = models.BooleanField(default=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_agents",
    )

    # Versioning
    version = models.PositiveIntegerField(default=1)
    definition_hash = models.CharField(max_length=64, blank=True, default="")

    metadata = models.JSONField(default=dict, blank=True)
    sort_order = models.FloatField(default=65535)

    class Meta:
        unique_together = ["workspace", "handle", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "handle"],
                condition=Q(deleted_at__isnull=True),
                name="workspace_agent_unique_workspace_handle_when_deleted_at_null",
            )
        ]
        verbose_name = "Workspace Agent"
        verbose_name_plural = "Workspace Agents"
        db_table = "workspace_agents"
        ordering = ("sort_order", "-created_at")

    def __str__(self):
        return f"@{self.handle} <{self.workspace_id}>"

    @property
    def is_assignable(self):
        """Whether the agent may receive new work item assignments."""
        return self.status == self.Status.ACTIVE and self.accept_assignments

    def canonical_definition(self):
        """Return the definition fields as a plain dict (the unit that is versioned and hashed)."""
        return {field: getattr(self, field) for field in DEFINITION_FIELDS}

    def compute_definition_hash(self):
        """Return the hash of the current definition."""
        return definition_hash(self.canonical_definition())


class WorkspaceAgentRevision(BaseModel):
    """Immutable snapshot of an agent's definition at a given version."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="agent_revisions")
    agent = models.ForeignKey(WorkspaceAgent, on_delete=models.CASCADE, related_name="revisions")
    version = models.PositiveIntegerField()
    definition = models.JSONField(default=dict)
    definition_hash = models.CharField(max_length=64)
    change_note = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        unique_together = ["agent", "version", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["agent", "version"],
                condition=Q(deleted_at__isnull=True),
                name="workspace_agent_revision_unique_agent_version_when_deleted_at_null",
            )
        ]
        verbose_name = "Workspace Agent Revision"
        verbose_name_plural = "Workspace Agent Revisions"
        db_table = "workspace_agent_revisions"
        ordering = ("-version",)

    def __str__(self):
        return f"{self.agent_id} v{self.version}"
