# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Lifecycle of agentic members, shared by the app API, the public API and MCP.

An agent is a bot ``User`` plus a ``WorkspaceMember`` (role 15), one
``ProjectMember`` (role 15) per project it can be assigned in, and a
``WorkspaceAgent`` definition. These helpers keep those rows consistent and
version the definition (a new ``WorkspaceAgentRevision`` per definition change).
"""

# Python imports
import uuid

# Django imports
from django.db import transaction
from django.db.models import Min

# Module imports
from plane.db.models import (
    BotTypeEnum,
    Project,
    ProjectMember,
    ProjectUserProperty,
    User,
    WorkspaceAgent,
    WorkspaceAgentRevision,
    WorkspaceMember,
)

AGENT_ROLE = 15
AGENT_EMAIL_DOMAIN = "agents.invalid"


def resolve_agent(workspace_slug, ref, queryset=None):
    """Return the agent of the workspace whose id or handle is ``ref``, or None."""
    qs = queryset if queryset is not None else WorkspaceAgent.objects.all()
    qs = qs.filter(workspace__slug=workspace_slug)
    try:
        return qs.get(pk=uuid.UUID(str(ref)))
    except (ValueError, WorkspaceAgent.DoesNotExist):
        return qs.filter(handle=str(ref).lower()).first()


def _sync_bot_user(agent):
    """Mirror the agent's name and handle onto its bot user."""
    user = agent.bot_user
    user.first_name = agent.name[:255]
    user.display_name = agent.handle
    user.save(update_fields=["first_name", "display_name", "updated_at"])


def _write_revision(agent, actor, change_note=""):
    WorkspaceAgentRevision(
        workspace_id=agent.workspace_id,
        agent=agent,
        version=agent.version,
        definition=agent.canonical_definition(),
        definition_hash=agent.definition_hash,
        change_note=(change_note or "")[:500],
    ).save(created_by_id=actor.id)


@transaction.atomic
def create_agent(workspace, actor, data, project_ids=None):
    """Create the bot user, workspace membership, definition (v1) and optional project access."""
    bot_id = uuid.uuid4()
    bot_user = User(
        id=bot_id,
        username=f"agent-{bot_id.hex}",
        email=f"agent+{bot_id.hex}@{AGENT_EMAIL_DOMAIN}",
        first_name=data["name"][:255],
        last_name="",
        display_name=data["handle"],
        is_bot=True,
        bot_type=BotTypeEnum.AGENT,
        is_password_autoset=True,
        is_email_verified=False,
    )
    bot_user.set_unusable_password()
    bot_user.save()

    WorkspaceMember.objects.create(workspace=workspace, member=bot_user, role=AGENT_ROLE, company_role="")

    agent = WorkspaceAgent(workspace=workspace, bot_user=bot_user, version=1, **data)
    if agent.owner_id is None and "owner" not in data:
        agent.owner = actor
    agent.definition_hash = agent.compute_definition_hash()
    agent.save(created_by_id=actor.id)
    _write_revision(agent, actor, "Created")

    if project_ids:
        grant_projects(agent, project_ids)
    return agent


@transaction.atomic
def update_agent(agent, data, actor, change_note=""):
    """Apply ``data`` to the agent; bump the version and snapshot it when the definition changed."""
    for field, value in data.items():
        setattr(agent, field, value)
    new_hash = agent.compute_definition_hash()
    definition_changed = new_hash != agent.definition_hash
    if definition_changed:
        agent.version += 1
        agent.definition_hash = new_hash
    agent.save()
    if definition_changed:
        _write_revision(agent, actor, change_note)
    if {"name", "handle"} & set(data):
        _sync_bot_user(agent)
    return agent


def _set_memberships_active(agent, is_active):
    WorkspaceMember.objects.filter(workspace_id=agent.workspace_id, member_id=agent.bot_user_id).update(
        is_active=is_active
    )
    ProjectMember.objects.filter(workspace_id=agent.workspace_id, member_id=agent.bot_user_id).update(
        is_active=is_active
    )


@transaction.atomic
def archive_agent(agent, actor):
    """Archive the agent: no new assignments and its memberships are deactivated."""
    agent.status = WorkspaceAgent.Status.ARCHIVED
    agent.save()
    _set_memberships_active(agent, False)
    return agent


@transaction.atomic
def restore_agent(agent, actor):
    """Restore an archived agent to active and reactivate its memberships."""
    agent.status = WorkspaceAgent.Status.ACTIVE
    agent.save()
    WorkspaceMember.objects.filter(workspace_id=agent.workspace_id, member_id=agent.bot_user_id).update(
        is_active=True
    )
    # Project access granted before archiving comes back with the agent
    ProjectMember.objects.filter(
        workspace_id=agent.workspace_id, member_id=agent.bot_user_id, deleted_at__isnull=True
    ).update(is_active=True)
    return agent


@transaction.atomic
def delete_agent(agent):
    """Soft-delete the agent; existing assignments stay for history but the bot can never be used again."""
    _set_memberships_active(agent, False)
    bot_user = agent.bot_user
    bot_user.is_active = False
    bot_user.save(update_fields=["is_active", "updated_at"])
    agent.delete()


def agent_project_ids(agent):
    """Ids of the projects the agent can currently be assigned in."""
    return list(
        ProjectMember.objects.filter(
            workspace_id=agent.workspace_id,
            member_id=agent.bot_user_id,
            is_active=True,
            project__archived_at__isnull=True,
        ).values_list("project_id", flat=True)
    )


@transaction.atomic
def grant_projects(agent, project_ids):
    """Give the agent member access (role 15) to the given projects of its workspace."""
    projects = list(
        Project.objects.filter(workspace_id=agent.workspace_id, pk__in=project_ids, archived_at__isnull=True)
    )
    existing = {
        pm.project_id: pm
        for pm in ProjectMember.objects.filter(member_id=agent.bot_user_id, project__in=projects)
    }
    to_update = []
    to_create = []
    for project in projects:
        pm = existing.get(project.id)
        if pm:
            pm.is_active = True
            pm.role = AGENT_ROLE
            to_update.append(pm)
        else:
            to_create.append(
                ProjectMember(
                    member_id=agent.bot_user_id,
                    project_id=project.id,
                    workspace_id=agent.workspace_id,
                    role=AGENT_ROLE,
                )
            )
    ProjectMember.objects.bulk_update(to_update, ["is_active", "role"], batch_size=100)
    ProjectMember.objects.bulk_create(to_create, batch_size=100, ignore_conflicts=True)

    min_sort = ProjectUserProperty.objects.filter(user_id=agent.bot_user_id).aggregate(m=Min("sort_order"))["m"]
    ProjectUserProperty.objects.bulk_create(
        [
            ProjectUserProperty(
                user_id=agent.bot_user_id,
                project_id=project.id,
                workspace_id=agent.workspace_id,
                sort_order=(min_sort - 10000) if min_sort is not None else 65535,
            )
            for project in projects
        ],
        batch_size=100,
        ignore_conflicts=True,
    )
    return [project.id for project in projects]


def revoke_project(agent, project_id):
    """Remove the agent's access to a project (existing assignments are kept)."""
    return ProjectMember.objects.filter(
        workspace_id=agent.workspace_id, member_id=agent.bot_user_id, project_id=project_id, is_active=True
    ).update(is_active=False)
