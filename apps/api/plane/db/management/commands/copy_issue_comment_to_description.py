# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Management command ``copy_issue_comment_to_description``: data migration helper.

Backfills a ``Description`` row for every ``IssueComment`` that has no
``description_id`` yet, copying the comment's json/html/stripped content and
audit fields, then links the comment to the new description.
"""

# Django imports
from django.core.management.base import BaseCommand
from django.db import transaction

# Module imports
from plane.db.models import Description
from plane.db.models import IssueComment


class Command(BaseCommand):
    """Create and link ``Description`` records for existing ``IssueComment`` rows."""

    help = "Create Description records for existing IssueComment"

    def handle(self, *args, **kwargs):
        """Process comments in batches of 500 until none are left without a description."""
        batch_size = 500

        # Each iteration re-queries unlinked comments, so processed rows drop out of
        # the filter and the loop terminates once every comment has a description.
        while True:
            comments = list(
                IssueComment.objects.filter(description_id__isnull=True).order_by("created_at")[:batch_size]
            )

            if not comments:
                break

            with transaction.atomic():
                descriptions = [
                    Description(
                        created_at=comment.created_at,
                        updated_at=comment.updated_at,
                        description_json=comment.comment_json,
                        description_html=comment.comment_html,
                        description_stripped=comment.comment_stripped,
                        project_id=comment.project_id,
                        created_by_id=comment.created_by_id,
                        updated_by_id=comment.updated_by_id,
                        workspace_id=comment.workspace_id,
                    )
                    for comment in comments
                ]

                created_descriptions = Description.objects.bulk_create(descriptions)

                # bulk_create returns objects in input order (with PKs on PostgreSQL),
                # so zip pairs each comment with the description created from it.
                comments_to_update = []
                for comment, description in zip(comments, created_descriptions):
                    comment.description_id = description.id
                    comments_to_update.append(comment)

                IssueComment.objects.bulk_update(comments_to_update, ["description_id"])

        self.stdout.write(self.style.SUCCESS("Successfully Copied IssueComment to Description"))
