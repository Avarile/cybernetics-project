# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Edge authentication for the MCP endpoint.

MCP clients send a Plane API token either as ``Authorization: Bearer <token>``
or as ``X-Api-Key``. The token is validated with exactly the same rules as the
public API (``APIKeyAuthentication``) and the resolved caller is exposed to
tool handlers through a ContextVar.
"""

# Python imports
import json
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Optional

# Third party imports
from rest_framework.exceptions import AuthenticationFailed

# Module imports
from plane.api.middleware.api_authentication import APIKeyAuthentication
from plane.mcp.services import db_call


@dataclass(frozen=True)
class PlaneCaller:
    """The authenticated MCP caller and the transport details needed to replay its requests."""

    user_id: str
    token: str
    host: str
    scheme: str
    forwarded_for: Optional[str]
    user_agent: str


_current_caller: ContextVar[Optional[PlaneCaller]] = ContextVar("plane_mcp_caller", default=None)


def get_caller() -> PlaneCaller:
    """Return the caller authenticated for the current MCP request; raise if called outside one."""
    caller = _current_caller.get()
    if caller is None:
        raise RuntimeError("No authenticated Plane caller in the current MCP request")
    return caller


def get_header(scope, name: bytes) -> Optional[str]:
    """Return the first ASGI header named ``name`` (lower-case bytes) as str, or None."""
    for key, value in scope.get("headers", []):
        if key == name:
            return value.decode("latin-1")
    return None


def extract_token(scope) -> Optional[str]:
    """Return the API token from a Bearer ``Authorization`` header, else from ``X-Api-Key``."""
    authorization = get_header(scope, b"authorization")
    if authorization:
        scheme, _, credentials = authorization.partition(" ")
        if scheme.lower() == "bearer" and credentials.strip():
            return credentials.strip()

    api_key = get_header(scope, b"x-api-key")
    return api_key.strip() if api_key and api_key.strip() else None


def _validate_token(token: str) -> Optional[str]:
    """Return the user id owning ``token`` if it is a valid API token, else None (sync; runs DB queries)."""
    try:
        user, _ = APIKeyAuthentication().validate_api_token(token)
    except AuthenticationFailed:
        return None
    return str(user.id)


# Async wrapper so the DB lookup runs off the event loop.
validate_token = db_call(_validate_token)


def build_caller(scope, user_id: str, token: str) -> PlaneCaller:
    """Build a PlaneCaller from the request scope, keeping host/scheme/client IP for the loopback replay."""
    client = scope.get("client")
    forwarded_for = get_header(scope, b"x-forwarded-for") or (client[0] if client else None)
    return PlaneCaller(
        user_id=user_id,
        token=token,
        host=get_header(scope, b"host") or "localhost",
        scheme=get_header(scope, b"x-forwarded-proto") or scope.get("scheme", "http"),
        forwarded_for=forwarded_for,
        user_agent=get_header(scope, b"user-agent") or "unknown",
    )


async def send_unauthorized(send) -> None:
    """Send a 401 JSON response with a Bearer ``WWW-Authenticate`` challenge."""
    body = json.dumps({"error": "A valid Plane API token is required"}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"www-authenticate", b'Bearer realm="plane"'),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class MCPAuthMiddleware:
    """Pure ASGI middleware that rejects unauthenticated MCP requests with a 401."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        """Authenticate the HTTP request's token, then run the app with the caller bound to the ContextVar."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        token = extract_token(scope)
        user_id = await validate_token(token) if token else None
        if user_id is None:
            await send_unauthorized(send)
            return

        # Expose the caller to tool handlers for the duration of this request only.
        reset_token = _current_caller.set(build_caller(scope, user_id, token))
        try:
            await self.app(scope, receive, send)
        finally:
            _current_caller.reset(reset_token)
