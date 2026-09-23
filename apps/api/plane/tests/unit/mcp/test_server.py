# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for ``plane.mcp.server`` (tool registry, transport security) and work-item filter building."""

import pytest

from plane.mcp.server import build_server, transport_security
from plane.mcp.services.work_item_query import WorkItemQuery, build_filter_params

# Tools that mutate data; they must be hidden when MCP_READ_ONLY is on.
WRITE_TOOLS = {"create_work_item", "update_work_item", "delete_work_item", "add_work_item_comment", "create_cycle"}


async def tool_names(server):
    """Return the set of tool names registered on ``server``."""
    return {tool.name for tool in await server.list_tools()}


@pytest.mark.unit
class TestToolRegistry:
    """Which tools ``build_server`` registers and the MCP hints they carry."""

    @pytest.mark.anyio
    async def test_registers_read_and_write_tools(self, settings):
        settings.MCP_READ_ONLY = False

        names = await tool_names(build_server())

        assert {"list_workspaces", "list_work_items", "get_work_item"} <= names
        assert WRITE_TOOLS <= names

    @pytest.mark.anyio
    async def test_read_only_mode_hides_write_tools(self, settings):
        settings.MCP_READ_ONLY = True

        names = await tool_names(build_server())

        assert "list_work_items" in names
        assert not WRITE_TOOLS & names

    @pytest.mark.anyio
    async def test_annotations(self, settings):
        """Read/destructive hints let MCP clients decide when to ask the user for confirmation."""
        settings.MCP_READ_ONLY = False

        tools = {tool.name: tool for tool in await build_server().list_tools()}

        assert tools["list_work_items"].annotations.read_only_hint is True
        assert tools["create_work_item"].annotations.read_only_hint is False
        assert tools["delete_work_item"].annotations.destructive_hint is True


@pytest.mark.unit
class TestTransportSecurity:
    """DNS-rebinding protection settings derived from Django host settings."""

    @pytest.mark.parametrize("hosts", [["*"], [".example.com"], []])
    def test_disabled_for_wildcards(self, settings, hosts):
        """Protection is off when ``ALLOWED_HOSTS`` is empty or contains wildcards (no usable allowlist)."""
        settings.MCP_ALLOWED_HOSTS = []
        settings.ALLOWED_HOSTS = hosts

        assert transport_security().enable_dns_rebinding_protection is False

    def test_allowlist_from_allowed_hosts_and_web_url(self, settings):
        """Allowed hosts (plus any-port variants) and origins come from ``ALLOWED_HOSTS`` and ``WEB_URL``."""
        settings.MCP_ALLOWED_HOSTS = []
        settings.ALLOWED_HOSTS = ["api.example.com"]
        settings.WEB_URL = "https://plane.example.com"

        security = transport_security()

        assert security.enable_dns_rebinding_protection is True
        assert {"api.example.com", "api.example.com:*", "plane.example.com"} <= set(security.allowed_hosts)
        assert security.allowed_origins == ["https://plane.example.com"]

    def test_mcp_allowed_hosts_override(self, settings):
        """``MCP_ALLOWED_HOSTS`` replaces the ``ALLOWED_HOSTS``-derived allowlist."""
        settings.MCP_ALLOWED_HOSTS = ["mcp.example.com"]
        settings.ALLOWED_HOSTS = ["*"]
        settings.WEB_URL = None
        settings.APP_BASE_URL = None

        assert set(transport_security().allowed_hosts) == {"mcp.example.com", "mcp.example.com:*"}


@pytest.mark.unit
class TestBuildFilterParams:
    """``build_filter_params`` converts a ``WorkItemQuery`` into issue-filter query params."""

    def test_assignees_are_not_delegated_to_issue_filters(self):
        """Assignee filters (e.g. ``me``/``none``) are handled elsewhere, not passed through."""
        query = WorkItemQuery(workspace_slug="acme", assignees=["me", "none"])

        assert build_filter_params(query) == {}

    def test_only_set_filters_are_included(self):
        query = WorkItemQuery(workspace_slug="acme", state_groups=["started"], priorities=["high", "urgent"])

        assert build_filter_params(query) == {"state_group": "started", "priority": "high,urgent"}
