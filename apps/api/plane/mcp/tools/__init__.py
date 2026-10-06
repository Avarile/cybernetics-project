# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tool modules. Each module exposes ``register(tool)`` which adds its tools to the server."""

# Python imports
import logging

logger = logging.getLogger("plane.mcp")

# Tool groups in registration order; names match the module names and MCP_TOOLSETS values.
TOOL_GROUPS = [
    "context",
    "projects",
    "project_setup",
    "members",
    "work_items",
    "work_item_extras",
    "cycles",
    "modules",
    "intake",
    "estimates",
    "stickies",
    "agents",
]
# Always registered: clients need them to find workspace slugs and their own user id.
ALWAYS_ENABLED = {"context"}


def enabled_groups(toolsets: list[str]) -> list[str]:
    """Return the groups to register for the MCP_TOOLSETS value (empty means all); unknown names are logged."""
    if not toolsets:
        return list(TOOL_GROUPS)
    unknown = set(toolsets) - set(TOOL_GROUPS)
    if unknown:
        logger.warning("Ignoring unknown MCP_TOOLSETS entries: %s", ", ".join(sorted(unknown)))
    wanted = set(toolsets) | ALWAYS_ENABLED
    return [group for group in TOOL_GROUPS if group in wanted]


def register_all(tool, toolsets: list[str]) -> None:
    """Register the tools of every enabled tool module with the given ToolRegistry."""
    from importlib import import_module

    for group in enabled_groups(toolsets):
        import_module(f"plane.mcp.tools.{group}").register(tool)
