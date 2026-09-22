# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
ASGI wiring for the MCP endpoint.

``with_mcp`` wraps the project's ASGI application: HTTP requests to MCP_PATH go
to the MCP server (behind API token authentication), the ``lifespan`` scope
starts and stops the MCP session manager, and everything else is passed
through to Django unchanged.
"""

# Python imports
import logging
from contextlib import AsyncExitStack

# Django imports
from django.conf import settings

logger = logging.getLogger("plane.mcp")


def with_mcp(inner_app, django_asgi_app):
    if not settings.MCP_SERVER_ENABLED:
        return inner_app

    from plane.mcp.auth import MCPAuthMiddleware
    from plane.mcp.client import configure_client
    from plane.mcp.server import build_http_app, build_server

    server = build_server()
    mcp_app = MCPAuthMiddleware(build_http_app(server))
    client = configure_client(django_asgi_app)
    return MCPRouter(inner_app, mcp_app, server, client, settings.MCP_PATH)


async def send_method_not_allowed(send) -> None:
    body = b'{"error": "Only POST is supported on this endpoint"}'
    await send(
        {
            "type": "http.response.start",
            "status": 405,
            "headers": [
                (b"allow", b"POST"),
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class MCPRouter:
    def __init__(self, inner_app, mcp_app, server, client, path: str):
        self.inner_app = inner_app
        self.mcp_app = mcp_app
        self.server = server
        self.client = client
        self.path = path

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            await self.lifespan(receive, send)
            return

        if scope["type"] == "http" and scope["path"] in (self.path, self.path + "/"):
            # Stateless server: there is no standalone SSE stream (GET) and no session to end
            # (DELETE). Without this, the SDK holds a GET stream open with pings forever.
            if scope["method"] != "POST":
                await send_method_not_allowed(send)
                return
            # The MCP app only routes the exact path; avoid a redirect for a trailing slash
            if scope["path"] != self.path:
                scope = {**scope, "path": self.path, "raw_path": self.path.encode()}
            await self.mcp_app(scope, receive, send)
            return

        await self.inner_app(scope, receive, send)

    async def lifespan(self, receive, send):
        stack = AsyncExitStack()
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                try:
                    await stack.enter_async_context(self.server.session_manager.run())
                except Exception as e:
                    logger.exception("Failed to start the MCP session manager")
                    await send({"type": "lifespan.startup.failed", "message": str(e)})
                    return
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await stack.aclose()
                await self.client.aclose()
                await send({"type": "lifespan.shutdown.complete"})
                return
