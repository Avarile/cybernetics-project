# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Management command ``sync_issue_version``: backfill issue version history.

Prompts for a batch size and countdown and enqueues the ``schedule_issue_version``
Celery task (``plane.bgtasks.issue_version_sync``), which creates ``IssueVersion``
rows for existing issues in batches.
"""

# Django imports
from django.core.management.base import BaseCommand

# Module imports
from plane.bgtasks.issue_version_sync import schedule_issue_version


class Command(BaseCommand):
    """Enqueue the batched IssueVersion backfill task."""

    help = "Creates IssueVersion records for existing Issues in batches"

    def handle(self, *args, **options):
        """Read batch settings from stdin and dispatch the Celery task asynchronously."""
        batch_size = input("Enter the batch size: ")
        batch_countdown = input("Enter the batch countdown: ")

        # batch_size is passed through as the raw input string; countdown is the delay
        # (seconds) between scheduled batches
        schedule_issue_version.delay(batch_size=batch_size, countdown=int(batch_countdown))

        self.stdout.write(self.style.SUCCESS("Successfully created issue version task"))
