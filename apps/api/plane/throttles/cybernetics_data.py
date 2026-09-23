# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF throttle for the Cybernetics-Data proxy endpoints.

The rate comes from the "cybernetics_data" scope in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"].
"""

from rest_framework.throttling import UserRateThrottle


class CyberneticsDataProxyThrottle(UserRateThrottle):
    """Limits calls proxied to Cybernetics-Data, per user and project."""

    scope = "cybernetics_data"

    def get_cache_key(self, request, view):
        """Key the rate limit on (user, project_id) so each project has its own budget.

        Anonymous requests return None and are not throttled here.
        """
        if not request.user or not request.user.is_authenticated:
            return None
        ident = f"{request.user.pk}:{view.kwargs.get('project_id')}"
        return self.cache_format % {"scope": self.scope, "ident": ident}
