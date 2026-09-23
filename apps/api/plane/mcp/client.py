# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
In-process loopback client for the public REST API (``/api/v1``).

Every MCP tool call is replayed as an ordinary REST request through Django's
own ASGI application. Authentication, rate limiting, permissions, serializer
validation, activity/webhook side effects and API request logging therefore
behave exactly as they do for any other API consumer.
"""

# Python imports
import json
from typing import Any, Optional

# Third party imports
import anyio
import httpx
from django.conf import settings
from mcp.server.mcpserver.exceptions import ToolError

# Module imports
from plane.mcp.auth import get_caller

API_PREFIX = "/api/v1"
USER_AGENT = "plane-mcp/1.0"
MAX_ERROR_DETAIL_LENGTH = 2000


class PlaneAPIClient:
    """Async httpx client that sends requests straight into Django's ASGI app (no network hop)."""

    def __init__(self, django_asgi_app):
        # httpx does not enforce timeouts for in-process ASGI transports, see request()
        self._client = httpx.AsyncClient(transport=httpx.ASGITransport(app=django_asgi_app), timeout=None)

    async def aclose(self) -> None:
        """Close the underlying httpx client."""
        await self._client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict] = None,
        json_body: Optional[Any] = None,
    ) -> Any:
        """Call ``/api/v1/<path>`` as the current MCP caller and return the parsed JSON.

        Forwards the caller's API token, scheme, client IP and user agent so auth, rate limits
        and logging see the real client. ``None`` query params are dropped. Raises ToolError on
        timeout (``MCP_LOOPBACK_TIMEOUT``), transport failure or an error status.
        """
        caller = get_caller()
        headers = {
            "X-Api-Key": caller.token,
            "X-Forwarded-Proto": caller.scheme,
            "User-Agent": f"{USER_AGENT} ({caller.user_agent})",
            "Accept": "application/json",
        }
        if caller.forwarded_for:
            headers["X-Forwarded-For"] = caller.forwarded_for

        url = f"{caller.scheme}://{caller.host}{API_PREFIX}/{path.lstrip('/')}"
        query = {key: value for key, value in (params or {}).items() if value is not None}

        try:
            # Enforce the timeout ourselves since httpx ignores it for ASGI transports.
            with anyio.fail_after(settings.MCP_LOOPBACK_TIMEOUT):
                response = await self._client.request(method, url, params=query, json=json_body, headers=headers)
        except TimeoutError as e:
            raise ToolError("The Plane API did not respond in time, please try again") from e
        except httpx.HTTPError as e:
            raise ToolError("The Plane API request could not be completed") from e

        return parse_response(response)

    async def get(self, path: str, params: Optional[dict] = None) -> Any:
        return await self.request("GET", path, params=params)

    async def post(self, path: str, body: Any) -> Any:
        return await self.request("POST", path, json_body=body)

    async def patch(self, path: str, body: Any) -> Any:
        return await self.request("PATCH", path, json_body=body)

    async def delete(self, path: str) -> Any:
        return await self.request("DELETE", path)


def parse_response(response: httpx.Response) -> Any:
    """Convert a response into a tool result dict, or raise ToolError for status >= 400.

    Empty bodies become ``{"success": True}``; non-JSON bodies are truncated into ``detail``.
    """
    data = None
    if response.content:
        try:
            data = response.json()
        except ValueError:
            data = {"detail": response.text[:MAX_ERROR_DETAIL_LENGTH]}

    if response.status_code < 400:
        if data is None:
            return {"success": True}
        # Tool results must be JSON objects: some endpoints (e.g. current cycles) return a bare list
        return {"results": data} if isinstance(data, list) else data

    raise ToolError(error_message(response, data))


def error_message(response: httpx.Response, data: Any) -> str:
    """Build a concise, user-facing error message for a failed API response."""
    status = response.status_code
    if status == 401:
        return "The Plane API token is no longer valid"
    if status == 429:
        reset = response.headers.get("Retry-After") or response.headers.get("X-RateLimit-Reset")
        return f"Rate limit exceeded for this API token (retry after: {reset or 'unknown'})"
    if status >= 500:
        return f"The Plane API failed with status {status}, please try again later"

    detail = json.dumps(data, default=str)[:MAX_ERROR_DETAIL_LENGTH] if data is not None else ""
    if status == 403:
        return f"Permission denied (403): {detail}"
    if status == 404:
        return f"Not found (404): {detail}"
    return f"Request rejected ({status}): {detail}"


_client: Optional[PlaneAPIClient] = None


def configure_client(django_asgi_app) -> PlaneAPIClient:
    """Create the process-wide loopback client bound to ``django_asgi_app`` and return it."""
    global _client
    _client = PlaneAPIClient(django_asgi_app)
    return _client


def api() -> PlaneAPIClient:
    """Return the configured loopback client; raise if ``configure_client`` has not run."""
    if _client is None:
        raise RuntimeError("The MCP loopback client is not configured")
    return _client
