# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Endpoint logic for agentic members, shared by the app API and the public API.

Each mixin implements the HTTP handlers; ``plane.app.views.agent`` (session auth)
and ``plane.api.views.agent`` (API-key auth) combine them with their own base
view. ``{agent}`` in URLs is the agent id or its handle.

Permissions: workspace admins and members can read; only admins can write;
guests get 403 everywhere.
"""

# Python imports
import re
import uuid

# Django imports
from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse

# Third party imports
from rest_framework import status
from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.response import Response

# Module imports
from plane.app.serializers.agent import (
    WorkspaceAgentLiteSerializer,
    WorkspaceAgentRevisionSerializer,
    WorkspaceAgentSerializer,
)
from plane.db.models import (
    Issue,
    ProjectMember,
    Workspace,
    WorkspaceAgent,
    WorkspaceAgentRevision,
    WorkspaceMember,
)
from plane.db.models.agent import DEFINITION_FIELDS
from plane.utils.agents import lifecycle
from plane.utils.agents.context import agent_meta, build_context, work_item_payload

ADMIN = 20
MEMBER = 15
WORK_ITEM_KEY_RE = re.compile(r"^([A-Za-z0-9]{1,12})-(\d+)$")
STATE_GROUPS = {"backlog", "unstarted", "started", "completed", "cancelled"}
OPEN_STATE_GROUPS = ["backlog", "unstarted", "started"]


class AgentPermission(BasePermission):
    """Read: workspace admins and members. Write: workspace admins. Guests: never."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        roles = [ADMIN, MEMBER] if request.method in SAFE_METHODS else [ADMIN]
        return WorkspaceMember.objects.filter(
            workspace__slug=view.kwargs.get("slug"),
            member=request.user,
            role__in=roles,
            is_active=True,
        ).exists()


def _not_found(what="Agent"):
    return Response({"error": f"{what} not found"}, status=status.HTTP_404_NOT_FOUND)


def _markdown_response(text, etag=None):
    response = HttpResponse(text, content_type="text/markdown; charset=utf-8")
    if etag:
        response["ETag"] = f'"{etag}"'
    return response


def _etag_matches(request, etag):
    header = request.META.get("HTTP_IF_NONE_MATCH", "")
    return bool(etag) and f'"{etag}"' in [tag.strip() for tag in header.split(",")]


class AgentBaseMixin:
    """Common helpers; concrete views also inherit an app/api base view."""

    permission_classes = [AgentPermission]
    # Status filter applied to listings when ``?status=`` is not given
    default_list_status = "all"

    def get_agent(self, slug, agent):
        return lifecycle.resolve_agent(
            slug, agent, WorkspaceAgent.objects.select_related("bot_user", "owner", "workspace")
        )

    def serializer_context(self, slug):
        workspace = Workspace.objects.get(slug=slug)
        return {"workspace_id": workspace.id, "request": self.request}, workspace

    def visible_project_ids(self, slug):
        """Projects the requester is an active member of (work items outside them are hidden)."""
        return ProjectMember.objects.filter(
            workspace__slug=slug, member=self.request.user, is_active=True
        ).values_list("project_id", flat=True)


class AgentListCreateMixin(AgentBaseMixin):
    def get(self, request, slug):
        agents = WorkspaceAgent.objects.filter(workspace__slug=slug).select_related("bot_user", "owner")
        agent_status = request.query_params.get("status", self.default_list_status)
        if agent_status and agent_status != "all":
            agents = agents.filter(status__in=agent_status.split(","))
        search = request.query_params.get("search")
        if search:
            agents = agents.filter(
                Q(name__icontains=search) | Q(handle__icontains=search) | Q(summary__icontains=search)
            )
        capability = request.query_params.get("capability")
        if capability:
            agents = agents.filter(capabilities__contains=[capability])
        if request.query_params.get("view") == "lite":
            return Response(WorkspaceAgentLiteSerializer(agents, many=True).data)
        return Response(WorkspaceAgentSerializer(agents, many=True).data)

    def post(self, request, slug):
        context, workspace = self.serializer_context(slug)
        serializer = WorkspaceAgentSerializer(data=request.data, context=context)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        data.pop("change_note", None)
        project_ids = data.pop("initial_project_ids", None)
        if data.get("status") == WorkspaceAgent.Status.ARCHIVED:
            data.pop("status")
        agent = lifecycle.create_agent(workspace, request.user, data, project_ids=project_ids)
        return Response(WorkspaceAgentSerializer(agent).data, status=status.HTTP_201_CREATED)


class AgentDetailMixin(AgentBaseMixin):
    def get(self, request, slug, agent):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        return Response(WorkspaceAgentSerializer(instance).data)

    def patch(self, request, slug, agent):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        context, _ = self.serializer_context(slug)
        serializer = WorkspaceAgentSerializer(instance, data=request.data, partial=True, context=context)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        change_note = data.pop("change_note", "")
        data.pop("initial_project_ids", None)
        lifecycle.update_agent(instance, data, request.user, change_note=change_note)
        instance.refresh_from_db()
        return Response(WorkspaceAgentSerializer(instance).data)

    def delete(self, request, slug, agent):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        lifecycle.delete_agent(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AgentArchiveMixin(AgentBaseMixin):
    def post(self, request, slug, agent):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        lifecycle.archive_agent(instance, request.user)
        return Response(WorkspaceAgentSerializer(instance).data)


class AgentRestoreMixin(AgentBaseMixin):
    def post(self, request, slug, agent):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        lifecycle.restore_agent(instance, request.user)
        return Response(WorkspaceAgentSerializer(instance).data)


class AgentContextMixin(AgentBaseMixin):
    """Prompt-ready agent definition (Markdown or JSON), ETag-cached, optionally pinned to a version."""

    def get(self, request, slug, agent):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        fmt = request.query_params.get("format", "markdown")
        version = request.query_params.get("version")
        definition = instance.canonical_definition()
        meta = agent_meta(instance)
        if version:
            revision = WorkspaceAgentRevision.objects.filter(agent=instance, version=version).first()
            if not revision:
                return _not_found("Agent version")
            definition = revision.definition
            meta = agent_meta(instance, version=revision.version, definition_hash=revision.definition_hash)

        etag = f"{meta['definition_hash']}-{fmt}"
        if _etag_matches(request, etag):
            response = HttpResponse(status=status.HTTP_304_NOT_MODIFIED)
            response["ETag"] = f'"{etag}"'
            return response
        if fmt == "json":
            response = Response(build_context(definition, meta, fmt="json"))
            response["ETag"] = f'"{etag}"'
            return response
        return _markdown_response(build_context(definition, meta), etag)


class AgentContextPreviewMixin(AgentBaseMixin):
    """Render unsaved edits so the UI can preview exactly what LLMs will receive."""

    def post(self, request, slug, agent):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        context, _ = self.serializer_context(slug)
        serializer = WorkspaceAgentSerializer(instance, data=request.data, partial=True, context=context)
        serializer.is_valid(raise_exception=True)
        definition = instance.canonical_definition()
        definition.update({k: v for k, v in serializer.validated_data.items() if k in DEFINITION_FIELDS})
        changed = definition != instance.canonical_definition()
        meta = agent_meta(instance, version=instance.version + 1 if changed else instance.version)
        rendered = build_context(definition, meta)
        return Response(
            {
                "markdown": rendered,
                "json": build_context(definition, meta, fmt="json"),
                "size_bytes": len(rendered.encode("utf-8")),
                "version": meta["version"],
                "changed": changed,
            }
        )


class AgentRevisionListMixin(AgentBaseMixin):
    def get(self, request, slug, agent):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        revisions = WorkspaceAgentRevision.objects.filter(agent=instance).select_related("created_by")
        return Response(WorkspaceAgentRevisionSerializer(revisions, many=True).data)


class AgentRevisionDetailMixin(AgentBaseMixin):
    def get(self, request, slug, agent, version):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        revision = WorkspaceAgentRevision.objects.filter(agent=instance, version=version).first()
        if not revision:
            return _not_found("Agent version")
        return Response(WorkspaceAgentRevisionSerializer(revision).data)


class AgentProjectsMixin(AgentBaseMixin):
    def get(self, request, slug, agent):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        return Response({"project_ids": [str(pid) for pid in lifecycle.agent_project_ids(instance)]})

    def post(self, request, slug, agent):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        project_ids = request.data.get("project_ids")
        if not isinstance(project_ids, list) or not project_ids:
            return Response({"error": "project_ids must be a non-empty list"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            granted = lifecycle.grant_projects(instance, project_ids)
        except Exception:
            return Response({"error": "project_ids must be valid project ids"}, status=status.HTTP_400_BAD_REQUEST)
        if len(granted) != len(set(map(str, project_ids))):
            missing = sorted(set(map(str, project_ids)) - {str(pid) for pid in granted})
            return Response(
                {"error": "Some projects were not found in this workspace (or are archived)", "project_ids": missing},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {"project_ids": [str(pid) for pid in lifecycle.agent_project_ids(instance)]},
            status=status.HTTP_201_CREATED,
        )


class AgentProjectDetailMixin(AgentBaseMixin):
    def delete(self, request, slug, agent, project_id):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        lifecycle.revoke_project(instance, project_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


def _work_item_row(issue):
    key = f"{issue.project.identifier}-{issue.sequence_id}"
    return {
        "id": str(issue.id),
        "key": key,
        "name": issue.name,
        "project_id": str(issue.project_id),
        "project_identifier": issue.project.identifier,
        "state_id": str(issue.state_id) if issue.state_id else None,
        "state_name": issue.state.name if issue.state_id else None,
        "state_group": issue.state.group if issue.state_id else None,
        "priority": issue.priority,
        "start_date": issue.start_date,
        "target_date": issue.target_date,
        "sequence_id": issue.sequence_id,
        "updated_at": issue.updated_at,
    }


class AgentWorkItemsMixin(AgentBaseMixin):
    """Work items assigned to the agent, limited to projects the requester can see."""

    def get(self, request, slug, agent):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        issues = (
            Issue.issue_objects.filter(
                workspace__slug=slug,
                issue_assignee__assignee_id=instance.bot_user_id,
                issue_assignee__deleted_at__isnull=True,
                project_id__in=self.visible_project_ids(slug),
            )
            .select_related("project", "state")
            .distinct()
            .order_by("-updated_at")
        )
        state_group = request.query_params.get("state_group")
        if state_group == "open":
            issues = issues.filter(state__group__in=OPEN_STATE_GROUPS)
        elif state_group:
            groups = [g for g in state_group.split(",") if g in STATE_GROUPS]
            issues = issues.filter(state__group__in=groups)
        try:
            limit = max(1, min(int(request.query_params.get("limit", 100)), 250))
        except ValueError:
            limit = 100
        return Response([_work_item_row(issue) for issue in issues[:limit]])


class AgentWorkItemBriefMixin(AgentBaseMixin):
    """Task brief: the agent's context plus one of its assigned work items."""

    def get(self, request, slug, agent, work_item):
        instance = self.get_agent(slug, agent)
        if not instance:
            return _not_found()
        issues = Issue.issue_objects.filter(
            workspace__slug=slug,
            issue_assignee__assignee_id=instance.bot_user_id,
            issue_assignee__deleted_at__isnull=True,
            project_id__in=self.visible_project_ids(slug),
        ).select_related("project", "state", "parent", "workspace")
        match = WORK_ITEM_KEY_RE.match(str(work_item))
        if match:
            issues = issues.filter(project__identifier__iexact=match.group(1), sequence_id=int(match.group(2)))
        else:
            try:
                issues = issues.filter(pk=uuid.UUID(str(work_item)))
            except ValueError:
                return _not_found("Work item")
        issue = issues.distinct().first()
        if not issue:
            return Response(
                {"error": "Work item not found, not assigned to this agent, or not visible to you"},
                status=status.HTTP_404_NOT_FOUND,
            )
        fmt = request.query_params.get("format", "markdown")
        payload = work_item_payload(issue, web_url=getattr(settings, "WEB_URL", None))
        result = build_context(instance.canonical_definition(), agent_meta(instance), payload, fmt=fmt)
        if fmt == "json":
            return Response(result)
        return _markdown_response(result)
