# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Project membership lookup.

The public member detail endpoints are keyed by the ProjectMember id, but the
member list endpoint only returns user profiles. This resolves a user id to
its membership id so tools can take the user id the model already knows. The
write itself still goes through ``/api/v1``, which enforces admin rights.
"""

# Python imports
from typing import Optional

# Module imports
from plane.db.models import ProjectMember


def project_membership_id(caller_id: str, workspace_slug: str, project_id: str, user_id: str) -> Optional[str]:
    """Return the active membership id of ``user_id`` in the project, or None.

    Only answers for projects the caller is an active member of, so it reveals
    nothing the caller could not already see with list_project_members.
    """
    members = ProjectMember.objects.filter(
        workspace__slug=workspace_slug, project_id=project_id, is_active=True, deleted_at__isnull=True
    )
    if not members.filter(member_id=caller_id).exists():
        return None
    membership_id = members.filter(member_id=user_id).values_list("id", flat=True).first()
    return str(membership_id) if membership_id else None
