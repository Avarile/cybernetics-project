# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Per-API-key request throttling for the public REST API.

Rate comes from ``settings.API_KEY_RATE_LIMIT``; requests without an API key
are not throttled by this class.
"""

# Django imports
from django.conf import settings

# Third party imports
from rest_framework.throttling import SimpleRateThrottle


class ApiKeyRateThrottle(SimpleRateThrottle):
    """Throttle keyed on the X-Api-Key header, exposing remaining quota/reset info."""
    scope = "api_key"
    rate = settings.API_KEY_RATE_LIMIT

    def get_cache_key(self, request, view):
        """Return the cache key for this API key, or None to skip throttling."""
        # Retrieve the API key from the request header
        api_key = request.headers.get("X-Api-Key")
        if not api_key:
            return None  # Allow the request if there's no API key

        # Use the API key as part of the cache key
        return f"{self.scope}:{api_key}"

    def allow_request(self, request, view):
        """Apply the throttle and stash rate-limit info in ``request.META``.

        Sets ``X-RateLimit-Remaining`` and ``X-RateLimit-Reset`` so later code can
        surface them as response headers.
        """
        allowed = super().allow_request(request, view)

        if allowed:
            now = self.timer()
            # Calculate the remaining limit and reset time
            history = self.cache.get(self.key, [])

            # Remove old histories
            # History is newest-first, so expired timestamps are at the tail.
            while history and history[-1] <= now - self.duration:
                history.pop()

            # Calculate the requests
            num_requests = len(history)

            # Check available requests
            available = self.num_requests - num_requests

            # Unix timestamp for when the rate limit will reset
            reset_time = int(now + self.duration)

            # Add headers
            request.META["X-RateLimit-Remaining"] = max(0, available)
            request.META["X-RateLimit-Reset"] = reset_time

        return allowed
