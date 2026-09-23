# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that records issue description history (IssueDescriptionVersion).

Enqueued from the issue and intake API views whenever an issue is created or its
description changes. Edits by the same user within a short window are merged
into the latest version instead of creating a new one, to avoid version spam.
"""

from celery import shared_task
from django.db import transaction
from django.utils import timezone
from typing import Optional, Dict
import json

from plane.db.models import Issue, IssueDescriptionVersion
from plane.utils.exception_logger import log_exception


def should_update_existing_version(
    version: IssueDescriptionVersion, user_id: str, max_time_difference: int = 600
) -> bool:
    """Return True if ``version`` belongs to ``user_id`` and was saved within
    ``max_time_difference`` seconds (default 10 minutes), i.e. it can be amended in place.
    """
    if not version:
        return

    time_difference = (timezone.now() - version.last_saved_at).total_seconds()
    return str(version.owned_by_id) == str(user_id) and time_difference <= max_time_difference


def update_existing_version(version: IssueDescriptionVersion, issue) -> None:
    """Overwrite the version's description fields with the issue's current description."""
    version.description_json = issue.description_json
    version.description_html = issue.description_html
    version.description_binary = issue.description_binary
    version.description_stripped = issue.description_stripped
    version.last_saved_at = timezone.now()

    version.save(
        update_fields=[
            "description_json",
            "description_html",
            "description_binary",
            "description_stripped",
            "last_saved_at",
        ]
    )


@shared_task
def issue_description_version_task(updated_issue, issue_id, user_id, is_creating=False) -> Optional[bool]:
    """Create or amend an IssueDescriptionVersion after an issue description change.

    ``updated_issue`` is a JSON string of the issue before the update (or the
    request payload on create); if its ``description_html`` matches the current
    one and this is not a create, nothing is recorded. Errors are logged and swallowed.
    """
    try:
        # Parse updated issue data
        current_issue: Dict = json.loads(updated_issue) if updated_issue else {}

        # Get current issue
        issue = Issue.objects.get(id=issue_id)

        # Check if description has changed
        if current_issue.get("description_html") == issue.description_html and not is_creating:
            return

        with transaction.atomic():
            # Get latest version
            latest_version = (
                IssueDescriptionVersion.objects.filter(issue_id=issue_id).order_by("-last_saved_at").first()
            )

            # Determine whether to update existing or create new version
            if should_update_existing_version(version=latest_version, user_id=user_id):
                update_existing_version(latest_version, issue)
            else:
                IssueDescriptionVersion.log_issue_description_version(issue, user_id)

            return

    except Issue.DoesNotExist:
        # Issue no longer exists, skip processing
        return
    except json.JSONDecodeError as e:
        log_exception(f"Invalid JSON for updated_issue: {e}")
        return
    except Exception as e:
        log_exception(f"Error processing issue description version: {e}")
        return
