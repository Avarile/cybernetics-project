# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Import job model for bringing data in from external services (GitHub, Jira)."""

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .project import ProjectBaseModel


class Importer(ProjectBaseModel):
    """One import run into a project, with its status and the raw/config/imported payloads.

    ``token`` is the API token the importer uses to write data back into the app.
    """

    service = models.CharField(max_length=50, choices=(("github", "GitHub"), ("jira", "Jira")))
    status = models.CharField(
        max_length=50,
        choices=(
            ("queued", "Queued"),
            ("processing", "Processing"),
            ("completed", "Completed"),
            ("failed", "Failed"),
        ),
        default="queued",
    )
    initiated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="imports")
    metadata = models.JSONField(default=dict)
    config = models.JSONField(default=dict)
    data = models.JSONField(default=dict)
    token = models.ForeignKey("db.APIToken", on_delete=models.CASCADE, related_name="importer")
    imported_data = models.JSONField(null=True)

    class Meta:
        verbose_name = "Importer"
        verbose_name_plural = "Importers"
        db_table = "importers"
        ordering = ("-created_at",)

    def __str__(self):
        """Return name of the service"""
        return f"{self.service} <{self.project.name}>"
