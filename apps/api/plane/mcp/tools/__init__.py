# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""MCP tool modules. Each module exposes ``register(tool)`` which adds its tools to the server."""

def register_all(tool) -> None:
    """Register the tools of every tool module with the given ToolRegistry."""
    from plane.mcp.tools import context, cycles, intake, modules, projects, work_item_extras, work_items

    for module in (context, projects, work_items, work_item_extras, cycles, modules, intake):
        module.register(tool)
