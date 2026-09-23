# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF throttle for asset endpoints, rate-limited per asset rather than per user.

The rate comes from the "asset_id" scope in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"].
"""

from rest_framework.throttling import SimpleRateThrottle


class AssetRateThrottle(SimpleRateThrottle):
    """Throttle requests that target the same asset (view kwarg `asset_id`)."""

    scope = "asset_id"

    def get_cache_key(self, request, view):
        """Build the cache key from the URL's asset_id; no asset_id means no throttling."""
        asset_id = view.kwargs.get("asset_id")
        if not asset_id:
            return None
        return f"throttle_asset_{asset_id}"
