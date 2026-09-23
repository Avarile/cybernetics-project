# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models
from django.db.models import Q

# Module imports
from .project import ProjectBaseModel


class ProjectCyberneticsDataIntegration(ProjectBaseModel):
    """Per-project connection to a Cybernetics-Data deployment.

    The API token is stored Fernet-encrypted and is never returned by the API.
    """

    STATUS_CHOICES = (
        ("ok", "OK"),
        ("unauthorized", "Unauthorized"),
        ("forbidden", "Forbidden"),
        ("unreachable", "Unreachable"),
        ("error", "Error"),
        ("", "Never verified"),
    )

    base_url = models.CharField(max_length=2048)
    api_token_encrypted = models.TextField()
    token_hint = models.CharField(max_length=16, blank=True, default="")
    token_fingerprint = models.CharField(max_length=64)
    is_enabled = models.BooleanField(default=True)
    last_verified_at = models.DateTimeField(null=True, blank=True)
    last_verified_status = models.CharField(max_length=32, blank=True, default="", choices=STATUS_CHOICES)
    last_verified_message = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Project Cybernetics Data Integration"
        verbose_name_plural = "Project Cybernetics Data Integrations"
        db_table = "project_cybernetics_data_integrations"
        ordering = ("-created_at",)
        unique_together = ["project", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project"],
                condition=Q(deleted_at__isnull=True),
                name="project_cybernetics_data_unique_project_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.project_id} {self.base_url}"


class IssueCyberneticsRecord(ProjectBaseModel):
    """A Cybernetics-Data record referenced by a work item.

    Stores the foreign ids plus a small display snapshot; the snapshot is never
    authoritative and live data is always fetched through the proxy.
    """

    STATUS_CHOICES = (
        ("ok", "OK"),
        ("missing", "Missing"),
        ("forbidden", "Forbidden"),
    )

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_cybernetics_records")
    space_id = models.CharField(max_length=64, blank=True, default="")
    base_id = models.CharField(max_length=64)
    table_id = models.CharField(max_length=64)
    record_id = models.CharField(max_length=64)
    view_id = models.CharField(max_length=64, blank=True, default="")
    record_name = models.CharField(max_length=512, blank=True, default="")
    base_name = models.CharField(max_length=255, blank=True, default="")
    table_name = models.CharField(max_length=255, blank=True, default="")
    primary_field_id = models.CharField(max_length=64, blank=True, default="")
    preview = models.JSONField(default=dict)
    source_url = models.CharField(max_length=2048, blank=True, default="")
    snapshot_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, default="ok", choices=STATUS_CHOICES)

    class Meta:
        verbose_name = "Issue Cybernetics Record"
        verbose_name_plural = "Issue Cybernetics Records"
        db_table = "issue_cybernetics_records"
        ordering = ("-created_at",)
        unique_together = ["issue", "table_id", "record_id", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "table_id", "record_id"],
                condition=Q(deleted_at__isnull=True),
                name="issue_cybernetics_record_unique_when_deleted_at_null",
            )
        ]
        indexes = [
            models.Index(fields=["project", "table_id", "record_id"], name="icr_project_table_record_idx"),
        ]

    def __str__(self):
        return f"{self.issue_id} {self.table_id}/{self.record_id}"
