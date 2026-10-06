# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Unit tests for the MCP agent tools, prompt and resources (REST loopback mocked)."""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from mcp.server.mcpserver.exceptions import ToolError

from plane.mcp.server import build_server
from plane.mcp.tools import agents

SLUG = "acme"
CONTEXT = {"agent": {"handle": "qa-bot", "version": 2}, "rendered_markdown": "# Agent: QA Bot", "work_item": None}


def mock_api(mocker, **returns):
    client = MagicMock()
    for method in ("get", "post", "patch", "delete"):
        setattr(client, method, AsyncMock(return_value=returns.get(method, {"ok": True})))
    mocker.patch.object(agents, "api", return_value=client)
    return client


@pytest.mark.unit
@pytest.mark.anyio
class TestAgentTools:
    async def test_list_agents_uses_lite_view(self, mocker):
        client = mock_api(mocker)
        await agents.list_agents(SLUG, capability="testing")
        client.get.assert_awaited_once_with(
            "workspaces/acme/agents/",
            params={"status": "active", "capability": "testing", "search": None, "view": "lite"},
        )

    async def test_get_agent_context_returns_markdown(self, mocker):
        client = mock_api(mocker, get=CONTEXT)
        result = await agents.get_agent_context(SLUG, "qa-bot", version=2)
        client.get.assert_awaited_once_with(
            "workspaces/acme/agents/qa-bot/context/", params={"format": "json", "version": 2}
        )
        assert result == {"handle": "qa-bot", "version": 2, "markdown": "# Agent: QA Bot"}

    async def test_task_brief_path_uses_work_item_key(self, mocker):
        client = mock_api(mocker, get={**CONTEXT, "work_item": {"key": "WEB-1"}})
        result = await agents.get_agent_task_brief(SLUG, "qa-bot", "WEB-1")
        client.get.assert_awaited_once_with(
            "workspaces/acme/agents/qa-bot/work-items/WEB-1/brief/", params={"format": "json"}
        )
        assert result["work_item"] == {"key": "WEB-1"}

    async def test_create_agent_maps_project_ids(self, mocker):
        client = mock_api(mocker)
        project_id = uuid4()
        await agents.create_agent(SLUG, name="QA Bot", handle="qa-bot", project_ids=[project_id])
        client.post.assert_awaited_once_with(
            "workspaces/acme/agents/",
            {"name": "QA Bot", "handle": "qa-bot", "initial_project_ids": [str(project_id)]},
        )

    async def test_update_agent_renames_handle_field(self, mocker):
        client = mock_api(mocker)
        await agents.update_agent(SLUG, "qa-bot", new_handle="qa", change_note="rename")
        client.patch.assert_awaited_once_with(
            "workspaces/acme/agents/qa-bot/", {"handle": "qa", "change_note": "rename"}
        )

    async def test_update_agent_requires_a_field(self, mocker):
        client = mock_api(mocker)
        with pytest.raises(ToolError, match="at least one field"):
            await agents.update_agent(SLUG, "qa-bot")
        client.patch.assert_not_called()

    async def test_persona_prompt_uses_brief_when_work_item_given(self, mocker):
        mock_api(mocker, get={**CONTEXT, "rendered_markdown": "BRIEF"})
        assert await agents.agent_persona(SLUG, "qa-bot", "WEB-1") == "BRIEF"


@pytest.mark.unit
@pytest.mark.anyio
class TestAgentRegistration:
    async def test_prompt_and_resource_templates_registered(self, settings):
        settings.MCP_READ_ONLY = False
        settings.MCP_TOOLSETS = ["agents"]
        server = build_server()
        prompts = {prompt.name for prompt in await server.list_prompts()}
        templates = {template.uri_template for template in await server.list_resource_templates()}
        assert "agent_persona" in prompts
        assert "plane://workspaces/{slug}/agents/{handle}" in templates
        assert "plane://workspaces/{slug}/agents/{handle}/v/{version}" in templates

    async def test_read_only_mode_keeps_agent_read_tools(self, settings):
        settings.MCP_READ_ONLY = True
        settings.MCP_TOOLSETS = ["agents"]
        names = {tool.name for tool in await build_server().list_tools()}
        assert {"list_agents", "get_agent_context", "get_agent_task_brief"} <= names
        assert "create_agent" not in names
