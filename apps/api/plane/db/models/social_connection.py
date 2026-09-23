# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""OAuth/social login connections (Google, GitHub, GitLab, Jira) linked to a user."""

# Django imports
from django.conf import settings
from django.db import models
from django.utils import timezone

# Module import
from .base import BaseModel


class SocialLoginConnection(BaseModel):
    """A user's connection to an OAuth provider, holding the provider tokens and profile data."""

    # Note: the stored value is the capitalised name (e.g. "Google"), the display label is lowercase
    medium = models.CharField(
        max_length=20,
        choices=(
            ("Google", "google"),
            ("Github", "github"),
            ("GitLab", "gitlab"),
            ("Jira", "jira"),
        ),
        default=None,
    )
    last_login_at = models.DateTimeField(default=timezone.now, null=True)
    last_received_at = models.DateTimeField(default=timezone.now, null=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="user_login_connections",
    )
    token_data = models.JSONField(null=True)
    extra_data = models.JSONField(null=True)

    class Meta:
        verbose_name = "Social Login Connection"
        verbose_name_plural = "Social Login Connections"
        db_table = "social_login_connections"
        ordering = ("-created_at",)

    def __str__(self):
        """Return name of the user and medium"""
        return f"{self.medium} <{self.user.email}>"
