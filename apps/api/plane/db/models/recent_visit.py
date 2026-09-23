# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Recently visited entities per user (powers the "recents" list on the home page)."""

# Django imports
from django.db import models
from django.conf import settings

# Module imports
from .workspace import WorkspaceBaseModel


class EntityNameEnum(models.TextChoices):
    """Entity kinds that can be recorded as a recent visit."""

    VIEW = "VIEW", "View"
    PAGE = "PAGE", "Page"
    ISSUE = "ISSUE", "Issue"
    CYCLE = "CYCLE", "Cycle"
    MODULE = "MODULE", "Module"
    PROJECT = "PROJECT", "Project"


class UserRecentVisit(WorkspaceBaseModel):
    """A user's visit to an entity; ``visited_at`` is refreshed on every save (``auto_now``)."""

    entity_identifier = models.UUIDField(null=True)
    # One of EntityNameEnum values
    entity_name = models.CharField(max_length=30)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="user_recent_visit",
    )
    visited_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "User Recent Visit"
        verbose_name_plural = "User Recent Visits"
        db_table = "user_recent_visits"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.entity_name} {self.user.email}"
