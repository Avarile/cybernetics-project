# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json

import httpx
import pytest
from mcp.server.mcpserver.exceptions import ToolError

from plane.mcp.auth import PlaneCaller, _current_caller
from plane.mcp.client import PlaneAPIClient, parse_response


def response(status, body=None, headers=None):
    content = json.dumps(body).encode() if body is not None else b""
    return httpx.Response(status, content=content, headers=headers or {})


@pytest.mark.unit
class TestParseResponse:
    def test_success_returns_json(self):
        assert parse_response(response(200, {"id": "1"})) == {"id": "1"}

    def test_no_content_returns_success(self):
        assert parse_response(response(204)) == {"success": True}

    def test_list_is_wrapped_in_an_object(self):
        assert parse_response(response(200, [{"id": "1"}])) == {"results": [{"id": "1"}]}

    @pytest.mark.parametrize(
        "status, body, headers, expected",
        [
            (400, {"name": ["This field is required."]}, None, 'Request rejected (400): {"name"'),
            (403, {"detail": "nope"}, None, "Permission denied (403)"),
            (404, {"error": "missing"}, None, "Not found (404)"),
            (409, {"error": "duplicate", "id": "x"}, None, "Request rejected (409)"),
            (401, {"detail": "bad"}, None, "The Plane API token is no longer valid"),
            (429, {"error": "slow down"}, {"Retry-After": "42"}, "retry after: 42"),
            (500, {"error": "boom"}, None, "failed with status 500"),
        ],
    )
    def test_errors_raise_tool_error(self, status, body, headers, expected):
        with pytest.raises(ToolError) as exc:
            parse_response(response(status, body, headers))
        assert expected in str(exc.value)

    def test_server_error_does_not_leak_body(self):
        with pytest.raises(ToolError) as exc:
            parse_response(response(500, {"error": "secret stack trace"}))
        assert "secret" not in str(exc.value)


@pytest.mark.unit
class TestLoopbackRequest:
    @pytest.mark.anyio
    async def test_replays_caller_identity(self):
        captured = {}

        async def fake_django(scope, receive, send):
            captured["scope"] = scope
            captured["body"] = (await receive())["body"]
            await send(
                {"type": "http.response.start", "status": 201, "headers": [(b"content-type", b"application/json")]}
            )
            await send({"type": "http.response.body", "body": b'{"id": "new"}'})

        caller = PlaneCaller(
            user_id="u1",
            token="plane_api_abc",
            host="plane.example.com",
            scheme="https",
            forwarded_for="203.0.113.9",
            user_agent="claude-code/2.0",
        )
        client = PlaneAPIClient(fake_django)
        reset = _current_caller.set(caller)
        try:
            result = await client.post("workspaces/acme/projects/p1/work-items/", {"name": "Bug"})
        finally:
            _current_caller.reset(reset)
            await client.aclose()

        scope = captured["scope"]
        headers = {k.decode(): v.decode() for k, v in scope["headers"]}
        assert result == {"id": "new"}
        assert scope["method"] == "POST"
        assert scope["path"] == "/api/v1/workspaces/acme/projects/p1/work-items/"
        assert headers["host"] == "plane.example.com"
        assert headers["x-api-key"] == "plane_api_abc"
        assert headers["x-forwarded-for"] == "203.0.113.9"
        assert headers["x-forwarded-proto"] == "https"
        assert headers["user-agent"].startswith("plane-mcp/")
        assert json.loads(captured["body"]) == {"name": "Bug"}

    @pytest.mark.anyio
    async def test_drops_unset_query_params(self):
        captured = {}

        async def fake_django(scope, receive, send):
            captured["query"] = scope["query_string"]
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        caller = PlaneCaller("u1", "k", "testserver", "http", None, "ua")
        client = PlaneAPIClient(fake_django)
        reset = _current_caller.set(caller)
        try:
            await client.get("users/me/", params={"cursor": None, "per_page": 50})
        finally:
            _current_caller.reset(reset)
            await client.aclose()

        assert captured["query"] == b"per_page=50"
