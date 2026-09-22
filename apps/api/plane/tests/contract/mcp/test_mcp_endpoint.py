# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
End-to-end tests for the MCP endpoint: JSON-RPC over the real ASGI app, through
the loopback into the real /api/v1 views. The loopback runs Django in another
thread with its own DB connection, so these tests need committed data
(``transaction=True``).
"""

import json
from contextlib import asynccontextmanager
from uuid import uuid4

import httpx
import pytest
from asgiref.sync import sync_to_async
from channels.routing import ProtocolTypeRouter

from plane.api.rate_limit import ApiKeyRateThrottle
from plane.db.models import APIToken, Issue, IssueAssignee, Project, ProjectMember, State, User
from plane.mcp.asgi import with_mcp

MODERN = "2026-07-28"
META = {
    "io.modelcontextprotocol/protocolVersion": MODERN,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": {"name": "pytest", "version": "1"},
}
BASE_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}

pytestmark = [pytest.mark.contract, pytest.mark.anyio, pytest.mark.django_db(transaction=True)]


@pytest.fixture
def token(create_user):
    # A unique token per test keeps the per-key rate limit history independent
    return APIToken.objects.create(user=create_user, label="MCP", token=f"plane_api_{uuid4().hex}").token


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(name="Web", identifier="WEB", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def todo_state(project):
    return State.objects.create(name="Todo", group="unstarted", project=project, default=True)


@pytest.fixture
def mcp_app(settings, mocker):
    settings.MCP_SERVER_ENABLED = True
    settings.MCP_READ_ONLY = False
    # Background work triggered by the real views
    mocker.patch("plane.api.views.issue.issue_activity.delay")
    mocker.patch("plane.api.views.issue.model_activity.delay")
    mocker.patch("plane.middleware.logger.process_logs.delay")

    from plane.asgi import django_asgi_app

    return with_mcp(ProtocolTypeRouter({"http": django_asgi_app}), django_asgi_app)


@asynccontextmanager
async def connect(app):
    async with app.server.session_manager.run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client


async def call_tool(client, token, name, arguments=None):
    headers = {
        **BASE_HEADERS,
        "Authorization": f"Bearer {token}",
        "MCP-Protocol-Version": MODERN,
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
    }
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments or {}, "_meta": META},
    }
    response = await client.post("/api/mcp", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()["result"]


def payload(result):
    assert result["isError"] is False, result["content"][0]["text"]
    return json.loads(result["content"][0]["text"])


class TestTransport:
    async def test_requires_token(self, mcp_app):
        async with connect(mcp_app) as client:
            response = await client.post("/api/mcp", headers=BASE_HEADERS, json={"jsonrpc": "2.0", "id": 1})

        assert response.status_code == 401
        assert response.headers["www-authenticate"] == 'Bearer realm="plane"'

    async def test_get_stream_is_not_offered(self, mcp_app, token):
        headers = {"Authorization": f"Bearer {token}", "Accept": "text/event-stream"}
        async with connect(mcp_app) as client:
            response = await client.get("/api/mcp", headers=headers)

        assert response.status_code == 405
        assert response.headers["allow"] == "POST"

    async def test_legacy_initialize_and_list(self, mcp_app, token):
        headers = {**BASE_HEADERS, "Authorization": f"Bearer {token}"}
        initialize = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "t", "version": "1"},
            },
        }
        async with connect(mcp_app) as client:
            init = await client.post("/api/mcp", headers=headers, json=initialize)
            listed = await client.post(
                "/api/mcp",
                headers={**headers, "MCP-Protocol-Version": "2025-06-18"},
                json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            )

        assert init.status_code == 200
        assert "Mcp-Session-Id" not in init.headers
        names = {tool["name"] for tool in listed.json()["result"]["tools"]}
        assert {"list_workspaces", "create_work_item"} <= names

    async def test_modern_list(self, mcp_app, token):
        headers = {**BASE_HEADERS, "Authorization": f"Bearer {token}", "MCP-Protocol-Version": MODERN}
        body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {"_meta": META}}
        async with connect(mcp_app) as client:
            response = await client.post("/api/mcp", headers={**headers, "Mcp-Method": "tools/list"}, json=body)

        assert response.status_code == 200
        assert len(response.json()["result"]["tools"]) > 20


class TestTools:
    async def test_get_current_user_uses_loopback(self, mcp_app, token, create_user):
        async with connect(mcp_app) as client:
            result = payload(await call_tool(client, token, "get_current_user"))

        assert result["id"] == str(create_user.id)

    async def test_list_workspaces(self, mcp_app, token, workspace):
        async with connect(mcp_app) as client:
            result = payload(await call_tool(client, token, "list_workspaces"))

        assert result["workspaces"] == [
            {"id": str(workspace.id), "name": workspace.name, "slug": workspace.slug, "role": "admin"}
        ]

    async def test_create_work_item_runs_public_api_side_effects(
        self, mcp_app, token, workspace, project, todo_state, create_user
    ):
        from plane.api.views.issue import issue_activity, model_activity
        from plane.middleware.logger import process_logs

        arguments = {
            "workspace_slug": workspace.slug,
            "project_id": str(project.id),
            "name": "Login button does nothing",
            "description_html": "<p>Steps</p>",
            "priority": "high",
            "state_id": str(todo_state.id),
            "assignee_ids": [str(create_user.id)],
        }
        async with connect(mcp_app) as client:
            result = payload(await call_tool(client, token, "create_work_item", arguments))

        issue = await Issue.objects.aget(pk=result["id"])
        assert issue.name == "Login button does nothing"
        assert issue.priority == "high"
        assert issue.created_by_id == create_user.id
        issue_activity.delay.assert_called_once()
        model_activity.delay.assert_called_once()
        log_data = process_logs.delay.call_args.kwargs["log_data"]
        assert log_data["user_agent"].startswith("plane-mcp/")
        assert log_data["path"].endswith("/work-items/")

    async def test_get_work_item_by_key(self, mcp_app, token, workspace, project, todo_state):
        issue = await sync_to_async(Issue.objects.create)(name="Fix it", project=project, state=todo_state)

        async with connect(mcp_app) as client:
            result = payload(
                await call_tool(client, token, "get_work_item", {"workspace_slug": workspace.slug, "key": "web-1"})
            )

        assert result["id"] == str(issue.id)
        assert result["state"]["name"] == "Todo"

    async def test_list_work_items_filters_and_scopes_to_member_projects(
        self, mcp_app, token, workspace, project, todo_state, create_user
    ):
        def seed():
            mine = Issue.objects.create(name="Mine", project=project, state=todo_state)
            Issue.objects.create(name="Unassigned", project=project, state=todo_state)
            IssueAssignee.objects.create(issue=mine, assignee=create_user, project=project, workspace=workspace)

            other = User.objects.create(email="other@plane.so", username="other")
            hidden = Project.objects.create(name="Hidden", identifier="HID", workspace=workspace, created_by=other)
            ProjectMember.objects.create(project=hidden, member=other, role=20, is_active=True)
            secret = Issue.objects.create(name="Secret", project=hidden)
            IssueAssignee.objects.create(issue=secret, assignee=create_user, project=hidden, workspace=workspace)
            return mine

        mine = await sync_to_async(seed)()

        async with connect(mcp_app) as client:
            everything = payload(await call_tool(client, token, "list_work_items", {"workspace_slug": workspace.slug}))
            assigned = payload(
                await call_tool(
                    client,
                    token,
                    "list_work_items",
                    {"workspace_slug": workspace.slug, "assignees": ["me"], "state_groups": ["unstarted"]},
                )
            )

        assert {item["name"] for item in everything["results"]} == {"Mine", "Unassigned"}
        assert everything["total"] == 2
        assert [item["id"] for item in assigned["results"]] == [str(mine.id)]
        assert assigned["results"][0]["key"] == "WEB-1"

    async def test_unassigned_filter_counts_items_whose_assignees_were_removed(
        self, mcp_app, token, workspace, project, todo_state, create_user
    ):
        def seed():
            mine = Issue.objects.create(name="Mine", project=project, state=todo_state)
            IssueAssignee.objects.create(issue=mine, assignee=create_user, project=project, workspace=workspace)
            cleared = Issue.objects.create(name="Cleared", project=project, state=todo_state)
            IssueAssignee.objects.create(issue=cleared, assignee=create_user, project=project, workspace=workspace)
            IssueAssignee.objects.filter(issue=cleared).delete()  # soft delete, as the serializer does
            never = Issue.objects.create(name="Never assigned", project=project, state=todo_state)
            return mine, cleared, never

        mine, cleared, never = await sync_to_async(seed)()

        async with connect(mcp_app) as client:
            unassigned = payload(
                await call_tool(
                    client, token, "list_work_items", {"workspace_slug": workspace.slug, "assignees": ["none"]}
                )
            )
            mine_or_unassigned = payload(
                await call_tool(
                    client, token, "list_work_items", {"workspace_slug": workspace.slug, "assignees": ["me", "none"]}
                )
            )

        assert {i["id"] for i in unassigned["results"]} == {str(cleared.id), str(never.id)}
        assert mine_or_unassigned["total"] == 3

    async def test_permission_errors_are_tool_errors(self, mcp_app, token, workspace):
        def foreign_project():
            other = User.objects.create(email="owner@plane.so", username="owner")
            return Project.objects.create(name="Private", identifier="PRV", workspace=workspace, created_by=other)

        private = await sync_to_async(foreign_project)()

        async with connect(mcp_app) as client:
            result = await call_tool(
                client,
                token,
                "create_work_item",
                {"workspace_slug": workspace.slug, "project_id": str(private.id), "name": "Sneaky"},
            )

        assert result["isError"] is True
        assert "403" in result["content"][0]["text"]
        assert not await Issue.objects.filter(project=private).aexists()

    async def test_rate_limit_is_shared_with_public_api(self, mcp_app, token, workspace, mocker):
        mocker.patch.object(ApiKeyRateThrottle, "rate", "1/minute")

        async with connect(mcp_app) as client:
            first = await call_tool(client, token, "list_workspaces")
            second = await call_tool(client, token, "get_current_user")

        assert first["isError"] is False
        assert second["isError"] is True
        assert "Rate limit exceeded" in second["content"][0]["text"]
