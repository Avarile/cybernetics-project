# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""GitHub integration models.

Map GitHub repositories, issues and comments to projects, work items and work
item comments so they can be kept in sync.
"""

# Python imports

# Django imports
from django.db import models

# Module imports
from plane.db.models.project import ProjectBaseModel


class GithubRepository(ProjectBaseModel):
    """A GitHub repository connected to a project (``repository_id`` is GitHub's id)."""

    name = models.CharField(max_length=500)
    url = models.URLField(null=True)
    config = models.JSONField(default=dict)
    repository_id = models.BigIntegerField()
    owner = models.CharField(max_length=500)

    def __str__(self):
        """Return the repo name"""
        return f"{self.name}"

    class Meta:
        verbose_name = "Repository"
        verbose_name_plural = "Repositories"
        db_table = "github_repositories"
        ordering = ("-created_at",)


class GithubRepositorySync(ProjectBaseModel):
    """Sync configuration between a repository and a project.

    ``actor`` is the bot user that performs synced changes and ``label`` is the
    label applied to work items created from GitHub.
    """

    repository = models.OneToOneField("db.GithubRepository", on_delete=models.CASCADE, related_name="syncs")
    credentials = models.JSONField(default=dict)
    # Bot user
    actor = models.ForeignKey("db.User", related_name="user_syncs", on_delete=models.CASCADE)
    workspace_integration = models.ForeignKey(
        "db.WorkspaceIntegration", related_name="github_syncs", on_delete=models.CASCADE
    )
    label = models.ForeignKey("db.Label", on_delete=models.SET_NULL, null=True, related_name="repo_syncs")

    def __str__(self):
        """Return the repo sync"""
        return f"{self.repository.name} <{self.project.name}>"

    class Meta:
        unique_together = ["project", "repository"]
        verbose_name = "Github Repository Sync"
        verbose_name_plural = "Github Repository Syncs"
        db_table = "github_repository_syncs"
        ordering = ("-created_at",)


class GithubIssueSync(ProjectBaseModel):
    """Links a GitHub issue to a work item within a repository sync."""

    repo_issue_id = models.BigIntegerField()
    github_issue_id = models.BigIntegerField()
    issue_url = models.URLField(blank=False)
    issue = models.ForeignKey("db.Issue", related_name="github_syncs", on_delete=models.CASCADE)
    repository_sync = models.ForeignKey("db.GithubRepositorySync", related_name="issue_syncs", on_delete=models.CASCADE)

    def __str__(self):
        """Return the github issue sync"""
        # Note: this model has no ``repository`` field (only ``repository_sync``), so this would raise AttributeError
        return f"{self.repository.name}-{self.project.name}-{self.issue.name}"

    class Meta:
        unique_together = ["repository_sync", "issue"]
        verbose_name = "Github Issue Sync"
        verbose_name_plural = "Github Issue Syncs"
        db_table = "github_issue_syncs"
        ordering = ("-created_at",)


class GithubCommentSync(ProjectBaseModel):
    """Links a GitHub issue comment to a work item comment within an issue sync."""

    repo_comment_id = models.BigIntegerField()
    comment = models.ForeignKey("db.IssueComment", related_name="comment_syncs", on_delete=models.CASCADE)
    issue_sync = models.ForeignKey("db.GithubIssueSync", related_name="comment_syncs", on_delete=models.CASCADE)

    def __str__(self):
        """Return the github issue sync"""
        return f"{self.comment.id}"

    class Meta:
        unique_together = ["issue_sync", "comment"]
        verbose_name = "Github Comment Sync"
        verbose_name_plural = "Github Comment Syncs"
        db_table = "github_comment_syncs"
        ordering = ("-created_at",)
