# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.http import HttpRequest

# Third party imports
from mcp.server.mcpserver.exceptions import ToolError

# Module imports
from plane.api.rate_limit import ApiKeyRateThrottle


def charge_api_key_rate_limit(token: str) -> None:
    """
    Count a direct-read tool call against the caller's public API rate limit,
    so MCP reads that don't go through /api/v1 share the same per-key budget.
    """
    request = HttpRequest()
    request.META["HTTP_X_API_KEY"] = token
    throttle = ApiKeyRateThrottle()
    if not throttle.allow_request(request, view=None):
        wait = throttle.wait()
        raise ToolError(f"Rate limit exceeded for this API token (retry after: {int(wait or 0)}s)")
