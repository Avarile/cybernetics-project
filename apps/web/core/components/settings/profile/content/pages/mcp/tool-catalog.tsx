/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
// plane imports
import { MCP_TOOLS, MCP_TOOL_GROUPS, MCP_TOOL_GROUP_LABELS, type TMCPTool, type TMCPToolMode } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Badge } from "@plane/propel/badge";
import { Input } from "@plane/propel/input";
// local imports

const MODE_VARIANT: Record<TMCPToolMode, "neutral" | "warning" | "danger"> = {
  read: "neutral",
  write: "warning",
  destructive: "danger",
};

export function MCPToolCatalog() {
  // states
  const [query, setQuery] = useState("");
  // translation
  const { t } = useTranslation();
  // derived values
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return MCP_TOOLS;
    return MCP_TOOLS.filter((tool) => tool.name.includes(needle) || tool.description.toLowerCase().includes(needle));
  }, [query]);

  const grouped = useMemo(
    () =>
      MCP_TOOL_GROUPS.map((group) => ({
        group,
        tools: matches.filter((tool) => tool.group === group),
      })).filter((entry) => entry.tools.length > 0),
    [matches]
  );

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-14 font-medium text-primary">{t("account_settings.mcp.tools.title")}</h4>
          <p className="mt-1 text-13 text-tertiary">{t("account_settings.mcp.tools.description")}</p>
        </div>
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("account_settings.mcp.tools.search_placeholder")}
          className="w-56"
        />
      </div>
      <div className="mt-4 space-y-5">
        {grouped.map(({ group, tools }) => (
          <div key={group}>
            <p className="text-11 tracking-wide text-placeholder uppercase">{t(MCP_TOOL_GROUP_LABELS[group])}</p>
            <div className="mt-2 divide-y divide-subtle rounded-md border-[0.5px] border-subtle">
              {tools.map((tool) => (
                <ToolRow key={tool.name} tool={tool} />
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 && (
          <p className="text-13 text-placeholder">{t("account_settings.mcp.tools.no_matches")}</p>
        )}
      </div>
      <p className="mt-4 text-11 text-placeholder">{t("account_settings.mcp.tools.footnote")}</p>
    </section>
  );
}

function ToolRow({ tool }: { tool: TMCPTool }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <div className="min-w-0">
        <p className="font-mono text-13 font-medium text-primary">{tool.name}</p>
        <p className="mt-0.5 text-12 text-tertiary">{tool.description}</p>
      </div>
      <span className="mt-0.5 flex-shrink-0">
        <Badge variant={MODE_VARIANT[tool.mode]} size="sm">
          {t(`account_settings.mcp.tools.modes.${tool.mode}`)}
        </Badge>
      </span>
    </div>
  );
}
