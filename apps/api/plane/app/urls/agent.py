# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for agentic members (``<str:agent>`` is the agent id or handle)."""

from django.urls import path

from plane.app.views.agent import (
    AgentArchiveEndpoint,
    AgentContextEndpoint,
    AgentContextPreviewEndpoint,
    AgentDetailEndpoint,
    AgentListCreateEndpoint,
    AgentProjectDetailEndpoint,
    AgentProjectsEndpoint,
    AgentRestoreEndpoint,
    AgentRevisionDetailEndpoint,
    AgentRevisionListEndpoint,
    AgentWorkItemBriefEndpoint,
    AgentWorkItemsEndpoint,
)

_AGENTS = "workspaces/<str:slug>/agents"
_AGENT = f"{_AGENTS}/<str:agent>"

urlpatterns = [
    path(f"{_AGENTS}/", AgentListCreateEndpoint.as_view(), name="workspace-agents"),
    path(f"{_AGENT}/", AgentDetailEndpoint.as_view(), name="workspace-agent"),
    path(f"{_AGENT}/archive/", AgentArchiveEndpoint.as_view(), name="workspace-agent-archive"),
    path(f"{_AGENT}/restore/", AgentRestoreEndpoint.as_view(), name="workspace-agent-restore"),
    path(f"{_AGENT}/context/", AgentContextEndpoint.as_view(), name="workspace-agent-context"),
    path(f"{_AGENT}/context-preview/", AgentContextPreviewEndpoint.as_view(), name="workspace-agent-context-preview"),
    path(f"{_AGENT}/revisions/", AgentRevisionListEndpoint.as_view(), name="workspace-agent-revisions"),
    path(
        f"{_AGENT}/revisions/<int:version>/",
        AgentRevisionDetailEndpoint.as_view(),
        name="workspace-agent-revision",
    ),
    path(f"{_AGENT}/projects/", AgentProjectsEndpoint.as_view(), name="workspace-agent-projects"),
    path(
        f"{_AGENT}/projects/<uuid:project_id>/",
        AgentProjectDetailEndpoint.as_view(),
        name="workspace-agent-project",
    ),
    path(f"{_AGENT}/work-items/", AgentWorkItemsEndpoint.as_view(), name="workspace-agent-work-items"),
    path(
        f"{_AGENT}/work-items/<str:work_item>/brief/",
        AgentWorkItemBriefEndpoint.as_view(),
        name="workspace-agent-work-item-brief",
    ),
]
