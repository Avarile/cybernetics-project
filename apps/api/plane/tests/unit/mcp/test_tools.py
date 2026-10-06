# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for MCP tool modules: toolsets, input checks raised as ToolError, payload mapping,
and that the frontend tool catalog (packages/constants/src/mcp.ts) matches the registered tools.

The REST loopback is replaced with a mock, so these tests need neither a database nor Django views.
"""

import re
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from mcp.server.mcpserver.exceptions import ToolError, UnexpectedToolError

from plane.mcp.server import build_server
from plane.mcp.services.work_item_query import WorkItemQuery, build_filter_params
from plane.mcp.tools import TOOL_GROUPS, enabled_groups
from plane.mcp.tools import cycles, estimates, intake, members, modules, projects, project_setup

SLUG = "acme"
CATALOG = Path(__file__).resolve().parents[6] / "packages" / "constants" / "src" / "mcp.ts"


@pytest.fixture
def all_tools(settings):
    """Writes enabled and every tool group exposed."""
    settings.MCP_READ_ONLY = False
    settings.MCP_TOOLSETS = []


def mock_api(mocker, module, **returns):
    """Replace ``api()`` in ``module`` with a mock client; ``returns`` sets per-method return values."""
    client = MagicMock()
    for method in ("get", "post", "patch", "delete"):
        setattr(client, method, AsyncMock(return_value=returns.get(method, {"ok": True})))
    mocker.patch.object(module, "api", return_value=client)
    return client


async def tools_by_name(server):
    return {tool.name: tool for tool in await server.list_tools()}


@pytest.mark.unit
class TestToolsets:
    """``MCP_TOOLSETS`` selects tool groups; ``context`` is always on."""

    @pytest.mark.anyio
    async def test_all_groups_by_default(self, all_tools):
        tools = await tools_by_name(build_server())

        assert len(tools) == 85
        assert {"create_project", "triage_intake_work_item", "create_estimate_points", "delete_sticky"} <= set(tools)

    @pytest.mark.anyio
    async def test_selected_groups_plus_context(self, settings):
        settings.MCP_READ_ONLY = False
        settings.MCP_TOOLSETS = ["work_items"]

        names = set(await tools_by_name(build_server()))

        assert "list_work_items" in names
        assert "get_current_user" in names
        assert "create_project" not in names
        assert "list_cycles" not in names

    def test_unknown_groups_are_ignored(self):
        assert enabled_groups(["cycles", "nope"]) == ["context", "cycles"]
        assert enabled_groups([]) == TOOL_GROUPS

    @pytest.mark.anyio
    async def test_read_only_mode_keeps_only_read_tools(self, settings):
        settings.MCP_READ_ONLY = True
        settings.MCP_TOOLSETS = []

        tools = await tools_by_name(build_server())

        assert tools
        assert all(tool.annotations.read_only_hint for tool in tools.values())
        assert {"list_intake_work_items", "get_estimate", "list_archived_cycles"} <= set(tools)

    @pytest.mark.anyio
    async def test_destructive_hints(self, all_tools):
        tools = await tools_by_name(build_server())

        for name in ("delete_project", "delete_state", "remove_project_member", "delete_cycle", "delete_estimate"):
            assert tools[name].annotations.destructive_hint is True, name
        assert tools["update_project"].annotations.destructive_hint is False


@pytest.mark.unit
class TestCatalogDrift:
    """The web app's tool catalog must list exactly the tools the server registers."""

    @pytest.mark.anyio
    async def test_frontend_catalog_matches_server(self, all_tools):
        if not CATALOG.exists():
            pytest.skip("packages/constants is not available (API-only checkout)")
        catalog = dict(
            re.findall(r'name: "([a-z_]+)",\n\s+group: "[a-z_]+",\n\s+mode: "([a-z]+)"', CATALOG.read_text())
        )
        tools = await tools_by_name(build_server())

        def mode(tool):
            if tool.annotations.read_only_hint:
                return "read"
            return "destructive" if tool.annotations.destructive_hint else "write"

        assert catalog == {name: mode(tool) for name, tool in tools.items()}


@pytest.mark.unit
@pytest.mark.anyio
class TestInputChecks:
    """Rules the input schema cannot express are rejected before any API call."""

    async def test_delete_project_refuses_identifier_mismatch(self, mocker):
        client = mock_api(mocker, projects, get={"id": "p", "identifier": "WEB"})

        with pytest.raises(ToolError, match="does not match"):
            await projects.delete_project(SLUG, uuid4(), confirm_identifier="APP")

        client.delete.assert_not_called()

    async def test_delete_project_with_matching_identifier(self, mocker):
        client = mock_api(mocker, projects, get={"id": "p", "identifier": "WEB"}, delete={"success": True})

        assert await projects.delete_project(SLUG, uuid4(), confirm_identifier="web") == {"success": True}
        client.delete.assert_awaited_once()

    async def test_update_without_fields_is_rejected(self, mocker):
        client = mock_api(mocker, project_setup)

        with pytest.raises(ToolError, match="at least one field"):
            await project_setup.update_label(SLUG, uuid4(), uuid4())

        client.patch.assert_not_called()

    @pytest.mark.parametrize(
        "start, end, message",
        [("2026-10-01", None, "both start_date and end_date"), ("2026-10-10", "2026-10-01", "must not be before")],
    )
    async def test_create_cycle_dates(self, mocker, start, end, message):
        client = mock_api(mocker, cycles)

        with pytest.raises(ToolError, match=message):
            await cycles.create_cycle(SLUG, uuid4(), "Sprint 1", start_date=start, end_date=end)

        client.post.assert_not_called()

    async def test_module_target_before_start_is_rejected(self, mocker):
        mock_api(mocker, modules)

        with pytest.raises(ToolError, match="target_date must not be before start_date"):
            await modules.update_module(SLUG, uuid4(), uuid4(), start_date="2026-10-10", target_date="2026-10-01")

    @pytest.mark.parametrize("action, missing", [("snooze", "snoozed_till"), ("duplicate", "duplicate_of_id")])
    async def test_triage_requires_its_argument(self, mocker, action, missing):
        client = mock_api(mocker, intake)

        with pytest.raises(ToolError, match=missing):
            await intake.triage_intake_work_item(SLUG, uuid4(), uuid4(), action=action)

        client.patch.assert_not_called()

    async def test_triage_ignored_by_api_is_reported(self, mocker):
        """The API answers 200 but keeps the status when the caller is not a project admin."""
        mock_api(mocker, intake, patch={"status": -2})

        with pytest.raises(ToolError, match="only project admins"):
            await intake.triage_intake_work_item(SLUG, uuid4(), uuid4(), action="accept")

    async def test_member_update_for_non_member(self, mocker):
        mocker.patch.object(members, "get_caller", return_value=MagicMock(user_id="me"))
        mocker.patch.object(members, "db_call", return_value=AsyncMock(return_value=None))
        client = mock_api(mocker, members)

        with pytest.raises(ToolError, match="not an active member"):
            await members.update_project_member(SLUG, uuid4(), uuid4(), role="admin")

        client.patch.assert_not_called()


@pytest.mark.unit
@pytest.mark.anyio
class TestPayloads:
    """Friendly tool arguments are mapped onto the REST payloads."""

    async def test_create_project_enables_cycles_and_modules(self, mocker):
        client = mock_api(mocker, projects)

        await projects.create_project(SLUG, name="Web", identifier="WEB")

        path, body = client.post.call_args.args
        assert path == f"workspaces/{SLUG}/projects/"
        assert body == {
            "name": "Web",
            "identifier": "WEB",
            "cycle_view": True,
            "module_view": True,
            "intake_view": False,
        }

    async def test_roles_are_mapped(self, mocker):
        client = mock_api(mocker, members)
        user_id = uuid4()

        await members.add_project_member(SLUG, uuid4(), user_id, role="guest")

        assert client.post.call_args.args[1] == {"member": str(user_id), "role": 5}

    async def test_triage_accept(self, mocker):
        client = mock_api(mocker, intake, patch={"status": 1})
        work_item_id = uuid4()

        await intake.triage_intake_work_item(SLUG, uuid4(), work_item_id, action="accept")

        path, body = client.patch.call_args.args
        assert path.endswith(f"/intake-issues/{work_item_id}/")
        assert body == {"status": 1}

    async def test_estimate_points_are_sent_as_a_list(self, mocker):
        client = mock_api(mocker, estimates)
        points = [estimates.EstimatePointInput(key=0, value="1"), estimates.EstimatePointInput(key=1, value="2")]

        await estimates.create_estimate_points(SLUG, uuid4(), uuid4(), points)

        assert client.post.call_args.args[1] == [{"key": 0, "value": "1"}, {"key": 1, "value": "2"}]


@pytest.mark.unit
class TestWorkItemFilters:
    """New ``list_work_items`` filters translate to ``issue_filters`` params."""

    def test_dates_parent_creator_and_estimate(self):
        parent = str(uuid4())
        query = WorkItemQuery(
            workspace_slug=SLUG,
            parent_id=parent,
            created_by="me",
            estimate_point_ids=["e1", "e2"],
            due_after="2026-10-01",
            due_before="2026-10-31",
            start_before="2026-10-15",
        )

        assert build_filter_params(query, user_id="u1") == {
            "parent": parent,
            "created_by": "u1",
            "estimate_point": "e1,e2",
            "target_date": "2026-10-01;after,2026-10-31;before",
            "start_date": "2026-10-15;before",
        }

    def test_top_level_only_is_not_an_issue_filter(self):
        """``parent_id='none'`` is applied as ``parent__isnull`` by the query, not passed to issue_filters."""
        assert build_filter_params(WorkItemQuery(workspace_slug=SLUG, parent_id="none")) == {}


@pytest.mark.unit
@pytest.mark.anyio
class TestCrashes:
    """An unexpected exception inside a tool never reaches the client."""

    async def test_crash_message_is_generic(self, all_tools, mocker):
        client = mock_api(mocker, projects)
        client.get.side_effect = RuntimeError("database password is hunter2")

        with pytest.raises(UnexpectedToolError) as raised:
            await build_server().call_tool("get_project", {"workspace_slug": SLUG, "project_id": str(uuid4())})

        assert str(raised.value) == "Error executing tool get_project"
        assert "hunter2" not in str(raised.value)
