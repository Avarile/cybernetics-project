# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for ``plane.mcp.asgi``: ``MCPRouter`` and ``with_mcp``.

The router sits in front of the Django ASGI app, sends POSTs to the MCP path to the MCP
server, everything else to Django, and ties the MCP session manager to the ASGI lifespan.
"""

from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from plane.mcp.asgi import MCPRouter, with_mcp


def recording_app(name, seen):
    """Return an ASGI app that records ``(name, path)`` into ``seen`` and sends nothing."""
    async def app(scope, receive, send):
        seen.append((name, scope["path"]))

    return app


def make_router(seen, events=None):
    """Build an ``MCPRouter`` with recording apps and a fake server/client that log lifecycle ``events``."""
    @asynccontextmanager
    async def run():
        events.append("started")
        yield
        events.append("stopped")

    async def aclose():
        events.append("client closed")

    server = SimpleNamespace(session_manager=SimpleNamespace(run=run))
    client = SimpleNamespace(aclose=aclose)
    return MCPRouter(recording_app("django", seen), recording_app("mcp", seen), server, client, "/api/mcp")


async def noop_receive():
    return {}


async def noop_send(message):
    pass


@pytest.mark.unit
class TestMCPRouter:
    """Path/method dispatch and lifespan handling of ``MCPRouter``."""

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "path, expected",
        [
            ("/api/mcp", ("mcp", "/api/mcp")),
            ("/api/mcp/", ("mcp", "/api/mcp")),
            ("/api/mcpx", ("django", "/api/mcpx")),
            ("/api/v1/users/me/", ("django", "/api/v1/users/me/")),
            ("/", ("django", "/")),
        ],
    )
    async def test_http_dispatch(self, path, expected):
        """Only the exact MCP path (with or without trailing slash) goes to the MCP app."""
        seen = []
        router = make_router(seen, [])

        await router({"type": "http", "path": path, "method": "POST"}, noop_receive, noop_send)

        assert seen == [expected]

    @pytest.mark.anyio
    @pytest.mark.parametrize("method", ["GET", "DELETE", "PUT", "OPTIONS"])
    async def test_non_post_is_rejected_without_reaching_the_mcp_app(self, method):
        """Non-POST requests to the MCP path get 405 with ``Allow: POST``."""
        seen, sent = [], []
        router = make_router(seen, [])

        async def send(message):
            sent.append(message)

        await router({"type": "http", "path": "/api/mcp", "method": method}, noop_receive, send)

        assert seen == []
        assert sent[0]["status"] == 405
        assert (b"allow", b"POST") in sent[0]["headers"]

    @pytest.mark.anyio
    async def test_non_mcp_get_passes_through(self):
        seen = []
        router = make_router(seen, [])

        await router({"type": "http", "path": "/api/v1/users/me/", "method": "GET"}, noop_receive, noop_send)

        assert seen == [("django", "/api/v1/users/me/")]

    @pytest.mark.anyio
    async def test_lifespan_starts_and_stops_session_manager(self):
        """Startup enters the session manager; shutdown exits it and closes the loopback client."""
        events, sent = [], []
        router = make_router([], events)
        messages = iter([{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}])

        async def receive():
            return next(messages)

        async def send(message):
            sent.append(message["type"])

        await router({"type": "lifespan"}, receive, send)

        assert sent == ["lifespan.startup.complete", "lifespan.shutdown.complete"]
        assert events == ["started", "stopped", "client closed"]

    def test_disabled_returns_inner_app_unchanged(self, settings):
        """With ``MCP_SERVER_ENABLED`` off, ``with_mcp`` is a no-op wrapper."""
        settings.MCP_SERVER_ENABLED = False
        inner = object()

        assert with_mcp(inner, object()) is inner
