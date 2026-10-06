# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Session-authenticated (web app) endpoints for agentic members."""

from plane.app.views.base import BaseAPIView

from .mixins import (
    AgentArchiveMixin,
    AgentContextMixin,
    AgentContextPreviewMixin,
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


class AgentListCreateEndpoint(AgentListCreateMixin, BaseAPIView):
    pass


class AgentDetailEndpoint(AgentDetailMixin, BaseAPIView):
    pass


class AgentArchiveEndpoint(AgentArchiveMixin, BaseAPIView):
    pass


class AgentRestoreEndpoint(AgentRestoreMixin, BaseAPIView):
    pass


class AgentContextEndpoint(AgentContextMixin, BaseAPIView):
    pass


class AgentContextPreviewEndpoint(AgentContextPreviewMixin, BaseAPIView):
    pass


class AgentRevisionListEndpoint(AgentRevisionListMixin, BaseAPIView):
    pass


class AgentRevisionDetailEndpoint(AgentRevisionDetailMixin, BaseAPIView):
    pass


class AgentProjectsEndpoint(AgentProjectsMixin, BaseAPIView):
    pass


class AgentProjectDetailEndpoint(AgentProjectDetailMixin, BaseAPIView):
    pass


class AgentWorkItemsEndpoint(AgentWorkItemsMixin, BaseAPIView):
    pass


class AgentWorkItemBriefEndpoint(AgentWorkItemBriefMixin, BaseAPIView):
    pass
