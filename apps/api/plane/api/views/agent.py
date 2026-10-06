# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public API (API-key auth) for agentic members.

This is the surface LLM platforms consume, directly over REST or through the MCP
server (which replays tool calls against these endpoints). ``{agent}`` is the
agent id or its handle. Admins and members can read; only admins can write.
"""

# Third party imports
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view

# Module imports
from plane.api.views.base import BaseAPIView
from plane.app.serializers.agent import WorkspaceAgentRevisionSerializer, WorkspaceAgentSerializer
from plane.app.views.agent.mixins import (
    AgentArchiveMixin,
    AgentContextMixin,
    AgentDetailMixin,
    AgentListCreateMixin,
    AgentProjectDetailMixin,
    AgentProjectsMixin,
    AgentRestoreMixin,
    AgentRevisionDetailMixin,
    AgentRevisionListMixin,
    AgentWorkItemBriefMixin,
    AgentWorkItemsMixin,
)

TAGS = ["Agents"]
FORMAT_PARAMETER = OpenApiParameter(
    name="format",
    type=OpenApiTypes.STR,
    enum=["markdown", "json"],
    description="`markdown` (default) returns text/markdown ready to use as a system prompt; `json` returns "
    "the structured definition plus `rendered_markdown`.",
)
VERSION_PARAMETER = OpenApiParameter(
    name="version",
    type=OpenApiTypes.INT,
    description="Pin a past definition version (see revisions). Defaults to the current version.",
)


@extend_schema_view(
    get=extend_schema(
        operation_id="list_agents",
        tags=TAGS,
        summary="List agents",
        description="List the workspace's agentic members. Use `view=lite` for a compact list (handle, name, "
        "summary, capabilities) to pick the right agent for a task. Filters: `status` (default `active`; "
        "`all` for every status), `search`, `capability`.",
        parameters=[
            OpenApiParameter(name="status", type=OpenApiTypes.STR),
            OpenApiParameter(name="search", type=OpenApiTypes.STR),
            OpenApiParameter(name="capability", type=OpenApiTypes.STR),
            OpenApiParameter(name="view", type=OpenApiTypes.STR, enum=["lite", "full"]),
        ],
        responses={200: WorkspaceAgentSerializer(many=True)},
    ),
    post=extend_schema(
        operation_id="create_agent",
        tags=TAGS,
        summary="Create an agent (admin)",
        request=WorkspaceAgentSerializer,
        responses={201: WorkspaceAgentSerializer},
    ),
)
class AgentListCreateAPIEndpoint(AgentListCreateMixin, BaseAPIView):
    default_list_status = "active"


@extend_schema_view(
    get=extend_schema(operation_id="get_agent", tags=TAGS, summary="Get an agent by id or handle"),
    patch=extend_schema(
        operation_id="update_agent",
        tags=TAGS,
        summary="Update an agent (admin)",
        description="Changing any definition field bumps `version` and records a revision; pass `change_note` "
        "to describe the change.",
        request=WorkspaceAgentSerializer,
    ),
    delete=extend_schema(operation_id="delete_agent", tags=TAGS, summary="Delete an agent (admin)"),
)
class AgentDetailAPIEndpoint(AgentDetailMixin, BaseAPIView):
    serializer_class = WorkspaceAgentSerializer


@extend_schema_view(post=extend_schema(operation_id="archive_agent", tags=TAGS, summary="Archive an agent (admin)"))
class AgentArchiveAPIEndpoint(AgentArchiveMixin, BaseAPIView):
    pass


@extend_schema_view(post=extend_schema(operation_id="restore_agent", tags=TAGS, summary="Restore an agent (admin)"))
class AgentRestoreAPIEndpoint(AgentRestoreMixin, BaseAPIView):
    pass


@extend_schema_view(
    get=extend_schema(
        operation_id="get_agent_context",
        tags=TAGS,
        summary="Get an agent's LLM context",
        description="The agent definition rendered as prompt-ready context. Responses carry an `ETag`; send "
        "`If-None-Match` to get `304 Not Modified` when the definition is unchanged.",
        parameters=[FORMAT_PARAMETER, VERSION_PARAMETER],
        responses={(200, "text/markdown"): OpenApiTypes.STR, 200: OpenApiTypes.OBJECT, 304: None},
    )
)
class AgentContextAPIEndpoint(AgentContextMixin, BaseAPIView):
    pass


@extend_schema_view(
    get=extend_schema(
        operation_id="list_agent_revisions",
        tags=TAGS,
        summary="List an agent's definition versions",
        responses={200: WorkspaceAgentRevisionSerializer(many=True)},
    )
)
class AgentRevisionListAPIEndpoint(AgentRevisionListMixin, BaseAPIView):
    pass


@extend_schema_view(
    get=extend_schema(
        operation_id="get_agent_revision",
        tags=TAGS,
        summary="Get one definition version",
        responses={200: WorkspaceAgentRevisionSerializer},
    )
)
class AgentRevisionDetailAPIEndpoint(AgentRevisionDetailMixin, BaseAPIView):
    pass


@extend_schema_view(
    get=extend_schema(operation_id="list_agent_projects", tags=TAGS, summary="Projects the agent can be assigned in"),
    post=extend_schema(
        operation_id="grant_agent_projects",
        tags=TAGS,
        summary="Give the agent access to projects (admin)",
        description='Body: `{"project_ids": ["<uuid>", ...]}`.',
        request=OpenApiTypes.OBJECT,
    ),
)
class AgentProjectsAPIEndpoint(AgentProjectsMixin, BaseAPIView):
    pass


@extend_schema_view(
    delete=extend_schema(operation_id="revoke_agent_project", tags=TAGS, summary="Remove project access (admin)")
)
class AgentProjectDetailAPIEndpoint(AgentProjectDetailMixin, BaseAPIView):
    pass


@extend_schema_view(
    get=extend_schema(
        operation_id="list_agent_work_items",
        tags=TAGS,
        summary="Work items assigned to the agent",
        description="Only items in projects you are a member of. `state_group`: `open` (backlog, unstarted, "
        "started) or a comma list of backlog/unstarted/started/completed/cancelled. `limit` ≤ 250.",
        parameters=[
            OpenApiParameter(name="state_group", type=OpenApiTypes.STR),
            OpenApiParameter(name="limit", type=OpenApiTypes.INT),
        ],
    )
)
class AgentWorkItemsAPIEndpoint(AgentWorkItemsMixin, BaseAPIView):
    pass


@extend_schema_view(
    get=extend_schema(
        operation_id="get_agent_task_brief",
        tags=TAGS,
        summary="Get a task brief (agent context + assigned work item)",
        description="`work_item` is a work item id or key such as `WEB-42`. Returns 404 when the item is not "
        "assigned to the agent or you cannot see its project.",
        parameters=[FORMAT_PARAMETER],
        responses={(200, "text/markdown"): OpenApiTypes.STR, 200: OpenApiTypes.OBJECT},
    )
)
class AgentWorkItemBriefAPIEndpoint(AgentWorkItemBriefMixin, BaseAPIView):
    pass
