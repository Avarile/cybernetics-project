# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django app configuration for the public API app (plane.api)."""

from django.apps import AppConfig


class ApiConfig(AppConfig):
    """AppConfig for plane.api; hooks OpenAPI auth extensions on startup."""

    name = "plane.api"

    def ready(self):
        """Register drf-spectacular authentication extensions if available."""
        # Import authentication extensions to register them with drf-spectacular
        try:
            import plane.utils.openapi.auth  # noqa
        except ImportError:
            pass
