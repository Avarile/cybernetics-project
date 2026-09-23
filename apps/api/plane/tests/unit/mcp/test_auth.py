# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for ``plane.mcp.auth``: token extraction and the ASGI ``MCPAuthMiddleware``.

The middleware guards the MCP endpoint (``/api/mcp``): it validates the Plane API token and
exposes the authenticated caller to tools via a context variable (``get_caller``).
"""

import pytest

from plane.mcp import auth
from plane.mcp.auth import MCPAuthMiddleware, extract_token, get_caller


def http_scope(headers=None, client=("10.0.0.1", 1234)):
    """Build a minimal ASGI HTTP scope for ``/api/mcp`` with the given request headers."""
    return {
        "type": "http",
        "path": "/api/mcp",
        "scheme": "http",
        "client": client,
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
    }


async def run_middleware(app, scope):
    """Drive an ASGI app with an empty request body and return all messages it sent."""
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    return sent


@pytest.mark.unit
class TestExtractToken:
    """``extract_token`` reads ``Authorization: Bearer`` first, then ``X-Api-Key``."""

    def test_bearer_token(self):
        assert extract_token(http_scope({"Authorization": "Bearer plane_api_abc"})) == "plane_api_abc"

    def test_bearer_scheme_is_case_insensitive(self):
        assert extract_token(http_scope({"Authorization": "bearer plane_api_abc"})) == "plane_api_abc"

    def test_x_api_key(self):
        assert extract_token(http_scope({"X-Api-Key": "plane_api_abc"})) == "plane_api_abc"

    def test_bearer_takes_precedence(self):
        scope = http_scope({"Authorization": "Bearer from_bearer", "X-Api-Key": "from_header"})
        assert extract_token(scope) == "from_bearer"

    def test_non_bearer_authorization_falls_back_to_api_key(self):
        scope = http_scope({"Authorization": "Basic Zm9vOmJhcg==", "X-Api-Key": "from_header"})
        assert extract_token(scope) == "from_header"

    @pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer "}, {"X-Api-Key": "  "}])
    def test_missing_token(self, headers):
        """Absent or blank credentials yield ``None``."""
        assert extract_token(http_scope(headers)) is None


@pytest.mark.unit
class TestMCPAuthMiddleware:
    """Request gating and caller context handling of ``MCPAuthMiddleware``."""

    @pytest.fixture
    def inner(self):
        """Downstream ASGI app that records ``get_caller()`` on each call and replies 200."""
        calls = []

        async def app(scope, receive, send):
            calls.append(get_caller())
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        app.calls = calls
        return app

    @pytest.mark.anyio
    async def test_missing_token_returns_401(self, inner):
        """No token: 401 with a ``WWW-Authenticate`` challenge and the inner app is never called."""
        sent = await run_middleware(MCPAuthMiddleware(inner), http_scope())

        assert sent[0]["status"] == 401
        assert (b"www-authenticate", b'Bearer realm="plane"') in sent[0]["headers"]
        assert inner.calls == []

    @pytest.mark.anyio
    async def test_invalid_token_returns_401(self, inner, mocker):
        mocker.patch.object(auth, "validate_token", mocker.AsyncMock(return_value=None))

        sent = await run_middleware(MCPAuthMiddleware(inner), http_scope({"Authorization": "Bearer nope"}))

        assert sent[0]["status"] == 401
        auth.validate_token.assert_awaited_once_with("nope")

    @pytest.mark.anyio
    async def test_valid_token_exposes_caller(self, inner, mocker):
        """The caller context carries user id, token and forwarded host/proto/IP/user agent."""
        mocker.patch.object(auth, "validate_token", mocker.AsyncMock(return_value="user-1"))
        scope = http_scope(
            {
                "Authorization": "Bearer plane_api_abc",
                "Host": "plane.example.com",
                "X-Forwarded-Proto": "https",
                "X-Forwarded-For": "203.0.113.9",
                "User-Agent": "claude-code/2.0",
            }
        )

        sent = await run_middleware(MCPAuthMiddleware(inner), scope)

        assert sent[0]["status"] == 200
        caller = inner.calls[0]
        assert caller.user_id == "user-1"
        assert caller.token == "plane_api_abc"
        assert caller.host == "plane.example.com"
        assert caller.scheme == "https"
        assert caller.forwarded_for == "203.0.113.9"
        assert caller.user_agent == "claude-code/2.0"

    @pytest.mark.anyio
    async def test_caller_is_reset_after_request(self, inner, mocker):
        """The context variable is cleared after the request, so the caller cannot leak."""
        mocker.patch.object(auth, "validate_token", mocker.AsyncMock(return_value="user-1"))

        await run_middleware(MCPAuthMiddleware(inner), http_scope({"X-Api-Key": "plane_api_abc"}))

        with pytest.raises(RuntimeError):
            get_caller()

    @pytest.mark.anyio
    async def test_client_address_used_when_not_forwarded(self, inner, mocker):
        """Without ``X-Forwarded-For`` the ASGI client address is used."""
        mocker.patch.object(auth, "validate_token", mocker.AsyncMock(return_value="user-1"))

        await run_middleware(MCPAuthMiddleware(inner), http_scope({"X-Api-Key": "k"}, client=("192.0.2.7", 5)))

        assert inner.calls[0].forwarded_for == "192.0.2.7"
