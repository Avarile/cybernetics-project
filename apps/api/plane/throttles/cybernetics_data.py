# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework.throttling import UserRateThrottle


class CyberneticsDataProxyThrottle(UserRateThrottle):
    """Limits calls proxied to Cybernetics-Data, per user and project."""

    scope = "cybernetics_data"

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        ident = f"{request.user.pk}:{view.kwargs.get('project_id')}"
        return self.cache_format % {"scope": self.scope, "ident": ident}
