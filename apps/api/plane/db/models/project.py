# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project models.

Defines ``Project`` (a workspace-scoped container for work items, cycles,
modules, pages, etc.), the abstract ``ProjectBaseModel`` that most
project-scoped models inherit from, project membership/invites, per-user
project settings, and the project identifier registry. Also exposes the
project role constants (``ROLE``/``ROLE_CHOICES``) used by permission checks.
"""

# Python imports
import pytz
from uuid import uuid4
from enum import Enum

# Django imports
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

# Module imports
from plane.db.mixins import AuditModel

from .base import BaseModel

# Project roles; a higher value means more privileges.
ROLE_CHOICES = ((20, "Admin"), (15, "Member"), (5, "Guest"))


class ROLE(Enum):
    """Enum form of the project role values in ``ROLE_CHOICES``."""

    ADMIN = 20
    MEMBER = 15
    GUEST = 5


class ProjectNetwork(Enum):
    """Project visibility: SECRET (invite-only) or PUBLIC (joinable by workspace members)."""

    SECRET = 0
    PUBLIC = 2

    @classmethod
    def choices(cls):
        """Return Django-style ``(value, label)`` choices."""
        return [(0, "Secret"), (2, "Public")]


def get_default_props():
    """Default saved filters/display filters for a member's project work item view."""
    return {
        "filters": {
            "priority": None,
            "state": None,
            "state_group": None,
            "assignees": None,
            "created_by": None,
            "labels": None,
            "start_date": None,
            "target_date": None,
            "subscriber": None,
        },
        "display_filters": {
            "group_by": None,
            "order_by": "-created_at",
            "type": None,
            "sub_issue": True,
            "show_empty_groups": True,
            "layout": "list",
            "calendar_date_range": "",
        },
    }


def get_default_preferences():
    """Default per-user project preferences (page display and navigation tab)."""
    return {"pages": {"block_display": True}, "navigation": {"default_tab": "work_items", "hide_in_more_menu": []}}


class Project(BaseModel):
    """A project within a workspace.

    ``identifier`` is the short uppercase key used in work item ids (e.g. "PROJ-12");
    it and ``name`` are unique per workspace among non-deleted projects. The
    ``*_view`` flags toggle optional features (cycles, modules, views, pages, intake).
    ``archive_in``/``close_in`` are month counts (0-12) for automatic archiving/closing.
    """

    NETWORK_CHOICES = ((0, "Secret"), (2, "Public"))
    name = models.CharField(max_length=255, verbose_name="Project Name")
    description = models.TextField(verbose_name="Project Description", blank=True)
    description_text = models.JSONField(verbose_name="Project Description RT", blank=True, null=True)
    description_html = models.JSONField(verbose_name="Project Description HTML", blank=True, null=True)
    network = models.PositiveSmallIntegerField(default=2, choices=NETWORK_CHOICES)
    workspace = models.ForeignKey("db.WorkSpace", on_delete=models.CASCADE, related_name="workspace_project")
    identifier = models.CharField(max_length=12, verbose_name="Project Identifier", db_index=True)
    default_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="default_assignee",
        null=True,
        blank=True,
    )
    project_lead = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_lead",
        null=True,
        blank=True,
    )
    emoji = models.CharField(max_length=255, null=True, blank=True)
    icon_prop = models.JSONField(null=True)
    module_view = models.BooleanField(default=False)
    cycle_view = models.BooleanField(default=False)
    issue_views_view = models.BooleanField(default=False)
    page_view = models.BooleanField(default=True)
    intake_view = models.BooleanField(default=False)
    is_time_tracking_enabled = models.BooleanField(default=False)
    is_issue_type_enabled = models.BooleanField(default=False)
    guest_view_all_features = models.BooleanField(default=False)
    cover_image = models.TextField(blank=True, null=True)
    cover_image_asset = models.ForeignKey(
        "db.FileAsset",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="project_cover_image",
    )
    estimate = models.ForeignKey("db.Estimate", on_delete=models.SET_NULL, related_name="projects", null=True)
    archive_in = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(12)])
    close_in = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(12)])
    logo_props = models.JSONField(default=dict)
    default_state = models.ForeignKey("db.State", on_delete=models.SET_NULL, null=True, related_name="default_state")
    archived_at = models.DateTimeField(null=True)
    # timezone
    TIMEZONE_CHOICES = tuple(zip(pytz.common_timezones, pytz.common_timezones))
    timezone = models.CharField(max_length=255, default="UTC", choices=TIMEZONE_CHOICES)
    # external_id for imports
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    def __init__(self, *args, **kwargs):
        # Track if timezone is provided, if so, don't override it with the workspace timezone when saving
        self.is_timezone_provided = kwargs.get("timezone") is not None
        super().__init__(*args, **kwargs)

    @property
    def cover_image_url(self):
        """Cover image URL, preferring the uploaded asset over the legacy ``cover_image`` value."""
        # Return cover image url
        if self.cover_image_asset:
            return self.cover_image_asset.asset_url

        # Return cover image url
        if self.cover_image:
            return self.cover_image

        return None

    def __str__(self):
        """Return name of the project"""
        return f"{self.name} <{self.workspace.name}>"

    # Identifiers containing any of these punctuation characters are rejected.
    FORBIDDEN_IDENTIFIER_CHARS_PATTERN = r"^.*[&+,:;$^}{*=?@#|'<>.()%!-].*$"

    class Meta:
        unique_together = [
            ["identifier", "workspace", "deleted_at"],
            ["name", "workspace", "deleted_at"],
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["identifier", "workspace"],
                condition=Q(deleted_at__isnull=True),
                name="project_unique_identifier_workspace_when_deleted_at_null",
            ),
            models.UniqueConstraint(
                fields=["name", "workspace"],
                condition=Q(deleted_at__isnull=True),
                name="project_unique_name_workspace_when_deleted_at_null",
            ),
        ]
        verbose_name = "Project"
        verbose_name_plural = "Projects"
        db_table = "projects"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        """Normalize the identifier to uppercase and inherit the workspace timezone on create.

        The workspace timezone is only applied if no ``timezone`` kwarg was passed
        to the constructor.
        """
        from plane.db.models import Workspace

        self.identifier = self.identifier.strip().upper()
        is_creating = self._state.adding

        if is_creating and not self.is_timezone_provided:
            workspace = Workspace.objects.get(id=self.workspace_id)
            self.timezone = workspace.timezone

        return super().save(*args, **kwargs)


class ProjectBaseModel(BaseModel):
    """Abstract base for project-scoped models; adds ``project`` and a denormalized ``workspace`` FK."""

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="project_%(class)s")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workspace_%(class)s")

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        """Always copy ``workspace`` from the project so the two can never diverge."""
        self.workspace = self.project.workspace
        super(ProjectBaseModel, self).save(*args, **kwargs)


class ProjectMemberInvite(ProjectBaseModel):
    """A pending invitation (by email + token) to join a project with a given role."""

    email = models.CharField(max_length=255)
    accepted = models.BooleanField(default=False)
    token = models.CharField(max_length=255)
    message = models.TextField(null=True)
    responded_at = models.DateTimeField(null=True)
    role = models.PositiveSmallIntegerField(choices=ROLE_CHOICES, default=5)

    class Meta:
        verbose_name = "Project Member Invite"
        verbose_name_plural = "Project Member Invites"
        db_table = "project_member_invites"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.project.name} {self.email} {self.accepted}"


class ProjectMember(ProjectBaseModel):
    """A user's membership in a project, with their role (see ``ROLE``) and view settings.

    ``is_active`` flags whether the membership is currently active.
    """

    member =models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="member_project",
    )
    comment = models.TextField(blank=True, null=True)
    role = models.PositiveSmallIntegerField(choices=ROLE_CHOICES, default=5)
    view_props = models.JSONField(default=get_default_props)
    default_props = models.JSONField(default=get_default_props)
    preferences = models.JSONField(default=get_default_preferences)
    sort_order = models.FloatField(default=65535)
    is_active = models.BooleanField(default=True)

    def save(self, *args, **kwargs):
        """On create, also create the member's ``ProjectUserProperty``.

        The new project is placed at the top of the user's sidebar ordering
        (min sort_order across their projects in the workspace minus 10000).
        """
        if self._state.adding and self.member:
            # Get the minimum sort_order for this member in the workspace
            min_sort_order_result = ProjectUserProperty.objects.filter(
                workspace_id=self.project.workspace_id, user=self.member
            ).aggregate(min_sort_order=models.Min("sort_order"))
            min_sort_order = min_sort_order_result.get("min_sort_order")

            # create project user property with project sort order
            ProjectUserProperty.objects.create(
                workspace_id=self.project.workspace_id,
                project=self.project,
                user=self.member,
                sort_order=(min_sort_order - 10000 if min_sort_order is not None else 65535),
            )

        super(ProjectMember, self).save(*args, **kwargs)

    class Meta:
        unique_together = ["project", "member", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "member"],
                condition=Q(deleted_at__isnull=True),
                name="project_member_unique_project_member_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Member"
        verbose_name_plural = "Project Members"
        db_table = "project_members"
        ordering = ("-created_at",)

    def __str__(self):
        """Return members of the project"""
        return f"{self.member.email} <{self.project.name}>"


# TODO: Remove workspace relation later
class ProjectIdentifier(AuditModel):
    """Registry reserving a project identifier name so it is unique within a workspace."""

    workspace = models.ForeignKey("db.Workspace", models.CASCADE, related_name="project_identifiers", null=True)
    project = models.OneToOneField(Project, on_delete=models.CASCADE, related_name="project_identifier")
    name = models.CharField(max_length=12, db_index=True)

    class Meta:
        unique_together = ["name", "workspace", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["name", "workspace"],
                condition=Q(deleted_at__isnull=True),
                name="unique_name_workspace_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Identifier"
        verbose_name_plural = "Project Identifiers"
        db_table = "project_identifiers"
        ordering = ("-created_at",)


def get_anchor():
    """Generate a random public anchor (hex UUID) for a deploy board URL."""
    return uuid4().hex


def get_default_views():
    """Default set of layouts enabled on a published project board."""
    return {
        "list": True,
        "kanban": True,
        "calendar": True,
        "gantt": True,
        "spreadsheet": True,
    }


# DEPRECATED TODO:
# used to get the old anchors for the project deploy boards
class ProjectDeployBoard(ProjectBaseModel):
    """Legacy public (published) project board settings; kept only to resolve old anchors."""

    anchor = models.CharField(max_length=255, default=get_anchor, unique=True, db_index=True)
    comments = models.BooleanField(default=False)
    reactions = models.BooleanField(default=False)
    intake = models.ForeignKey("db.Intake", related_name="board_intake", on_delete=models.SET_NULL, null=True)
    votes = models.BooleanField(default=False)
    views = models.JSONField(default=get_default_views)

    class Meta:
        unique_together = ["project", "anchor"]
        verbose_name = "Project Deploy Board"
        verbose_name_plural = "Project Deploy Boards"
        db_table = "project_deploy_boards"
        ordering = ("-created_at",)

    def __str__(self):
        """Return project and anchor"""
        return f"{self.anchor} <{self.project.name}>"


class ProjectPublicMember(ProjectBaseModel):
    """A user registered as a public member of a project (unique per project)."""

    member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="public_project_members",
    )

    class Meta:
        unique_together = ["project", "member", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "member"],
                condition=models.Q(deleted_at__isnull=True),
                name="project_public_member_unique_project_member_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Public Member"
        verbose_name_plural = "Project Public Members"
        db_table = "project_public_members"
        ordering = ("-created_at",)


class ProjectUserProperty(ProjectBaseModel):
    """Per-user project settings: saved work item filters/display options, preferences and sidebar order."""

    # Imported inside the class body to avoid a circular import with issue.py
    # (which imports ProjectBaseModel from this module).
    from .issue import get_default_filters, get_default_display_filters, get_default_display_properties

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_property_user",
    )
    filters = models.JSONField(default=get_default_filters)
    display_filters = models.JSONField(default=get_default_display_filters)
    display_properties = models.JSONField(default=get_default_display_properties)
    rich_filters = models.JSONField(default=dict)
    preferences = models.JSONField(default=get_default_preferences)
    sort_order = models.FloatField(default=65535)

    class Meta:
        verbose_name = "Project User Property"
        verbose_name_plural = "Project User Properties"
        db_table = "project_user_properties"
        ordering = ("-created_at",)
        unique_together = ["user", "project", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "project"],
                condition=Q(deleted_at__isnull=True),
                name="project_user_property_unique_user_project_when_deleted_at_null",
            )
        ]

    def __str__(self):
        """Return properties status of the project"""
        return str(self.user)
