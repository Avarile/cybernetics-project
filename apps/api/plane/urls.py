# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Root URL configuration (ROOT_URLCONF) for the Plane API server.

Mounts each app's URL module under its prefix:
- api/            -> plane.app (internal web-app API, session auth)
- api/public/     -> plane.space (public/published project views)
- api/instances/  -> plane.license (instance admin / setup)
- api/v1/         -> plane.api (external REST API, API-key auth)
- auth/           -> plane.authentication (sign-in/up, OAuth, magic links)
- ""              -> plane.web (robots.txt and health check)
Optionally adds OpenAPI schema/Swagger/Redoc routes and the Django debug toolbar.
"""

from django.conf import settings
from django.urls import include, path, re_path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

handler404 = "plane.app.views.error_404.custom_404_view"

urlpatterns = [
    path("api/", include("plane.app.urls")),
    path("api/public/", include("plane.space.urls")),
    path("api/instances/", include("plane.license.urls")),
    path("api/v1/", include("plane.api.urls")),
    path("auth/", include("plane.authentication.urls")),
    path("", include("plane.web.urls")),
]

# OpenAPI schema and interactive docs, only when explicitly enabled.
if settings.ENABLE_DRF_SPECTACULAR:
    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path(
            "api/schema/swagger-ui/",
            SpectacularSwaggerView.as_view(url_name="schema"),
            name="swagger-ui",
        ),
        path(
            "api/schema/redoc/",
            SpectacularRedocView.as_view(url_name="schema"),
            name="redoc",
        ),
    ]

# Debug toolbar routes in DEBUG mode; skipped silently if the package is not installed.
if settings.DEBUG:
    try:
        import debug_toolbar

        urlpatterns = [re_path(r"^__debug__/", include(debug_toolbar.urls))] + urlpatterns
    except ImportError:
        pass
