# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public API routes for workspace stickies, via a DRF router nested under the workspace slug."""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from plane.api.views import StickyViewSet


router = DefaultRouter()
router.register(r"stickies", StickyViewSet, basename="workspace-stickies")

urlpatterns = [
    path("workspaces/<str:slug>/", include(router.urls)),
]
