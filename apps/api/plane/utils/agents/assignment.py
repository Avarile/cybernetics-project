# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Assignment rules for agentic members.

Paused or archived agents (or agents with ``accept_assignments`` off) cannot be
given *new* work items. Work items they already hold keep them.
"""

# Module imports
from plane.db.models import IssueAssignee, WorkspaceAgent


def unassignable_agents(member_ids, issue_id=None):
    """Return ``{bot_user_id: handle}`` for agents in ``member_ids`` that may not be newly assigned.

    Agents already assigned to ``issue_id`` are not reported, so saving a work
    item never drops an existing assignment of a paused agent.
    """
    if not member_ids:
        return {}
    blocked = {
        agent.bot_user_id: agent.handle
        for agent in WorkspaceAgent.objects.filter(bot_user_id__in=list(member_ids)).only(
            "bot_user_id", "handle", "status", "accept_assignments"
        )
        if not agent.is_assignable
    }
    if blocked and issue_id:
        already = set(
            IssueAssignee.objects.filter(issue_id=issue_id, assignee_id__in=list(blocked)).values_list(
                "assignee_id", flat=True
            )
        )
        blocked = {user_id: handle for user_id, handle in blocked.items() if user_id not in already}
    return blocked


def is_assignable_member(member_id):
    """False when ``member_id`` is an agent that may not receive new assignments."""
    return not unassignable_agents([member_id])
