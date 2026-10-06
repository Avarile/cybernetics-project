# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public API routes for agentic members (``<str:agent>`` is the agent id or handle)."""

from django.urls import path

from plane.api.views.agent import (
    AgentArchiveAPIEndpoint,
    AgentContextAPIEndpoint,
    AgentDetailAPIEndpoint,
    AgentListCreateAPIEndpoint,
    AgentProjectDetailAPIEndpoint,
    AgentProjectsAPIEndpoint,
    AgentRestoreAPIEndpoint,
    AgentRevisionDetailAPIEndpoint,
    AgentRevisionListAPIEndpoint,
    AgentWorkItemBriefAPIEndpoint,
    AgentWorkItemsAPIEndpoint,
)

_AGENTS = "workspaces/<str:slug>/agents"
_AGENT = f"{_AGENTS}/<str:agent>"

urlpatterns = [
    path(f"{_AGENTS}/", AgentListCreateAPIEndpoint.as_view(http_method_names=["get", "post"]), name="agents"),
    path(
        f"{_AGENT}/",
        AgentDetailAPIEndpoint.as_view(http_method_names=["get", "patch", "delete"]),
        name="agent",
    ),
    path(f"{_AGENT}/archive/", AgentArchiveAPIEndpoint.as_view(http_method_names=["post"]), name="agent-archive"),
    path(f"{_AGENT}/restore/", AgentRestoreAPIEndpoint.as_view(http_method_names=["post"]), name="agent-restore"),
    path(f"{_AGENT}/context/", AgentContextAPIEndpoint.as_view(http_method_names=["get"]), name="agent-context"),
    path(
        f"{_AGENT}/revisions/",
        AgentRevisionListAPIEndpoint.as_view(http_method_names=["get"]),
        name="agent-revisions",
    ),
    path(
        f"{_AGENT}/revisions/<int:version>/",
        AgentRevisionDetailAPIEndpoint.as_view(http_method_names=["get"]),
        name="agent-revision",
    ),
    path(
        f"{_AGENT}/projects/",
        AgentProjectsAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="agent-projects",
    ),
    path(
        f"{_AGENT}/projects/<uuid:project_id>/",
        AgentProjectDetailAPIEndpoint.as_view(http_method_names=["delete"]),
        name="agent-project",
    ),
    path(
        f"{_AGENT}/work-items/",
        AgentWorkItemsAPIEndpoint.as_view(http_method_names=["get"]),
        name="agent-work-items",
    ),
    path(
        f"{_AGENT}/work-items/<str:work_item>/brief/",
        AgentWorkItemBriefAPIEndpoint.as_view(http_method_names=["get"]),
        name="agent-work-item-brief",
    ),
]
