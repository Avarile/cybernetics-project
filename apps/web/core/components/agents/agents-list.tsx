/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { Bot } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { IWorkspaceAgent, TAgentStatus } from "@plane/types";
import { Input, Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useAgent } from "@/hooks/store/use-agent";
// local components
import { AgentAvatar } from "./agent-avatar";
import { AgentStatusPill } from "./agent-status-pill";

type TStatusFilter = TAgentStatus | "all";
const FILTERS: TStatusFilter[] = ["all", "active", "paused", "archived"];

function AgentCard({ workspaceSlug, agent }: { workspaceSlug: string; agent: IWorkspaceAgent }) {
  const { t } = useTranslation();
  return (
    <Link
      href={`/${workspaceSlug}/agents/${agent.id}`}
      className="flex flex-col gap-3 rounded-lg border-[0.5px] border-subtle bg-layer-1 p-4 hover:bg-layer-1-hover"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar name={agent.name} logoProps={agent.logo_props} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-14 font-medium text-primary">{agent.name}</p>
            <AgentStatusPill status={agent.status} />
          </div>
          <p className="truncate text-12 text-tertiary">
            @{agent.handle}
            {agent.role_title ? ` · ${agent.role_title}` : ""}
          </p>
        </div>
      </div>
      <p className="line-clamp-2 min-h-8 text-13 text-secondary">{agent.summary || t("agents.list.no_summary")}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-tertiary">
        <span>{t("agents.list.version", { version: agent.version })}</span>
        <span>{t("agents.list.projects", { count: agent.project_ids.length })}</span>
        <span>{t("agents.list.open_items", { count: agent.assigned_open_count })}</span>
        {agent.owner && <span>{t("agents.list.owner", { name: agent.owner.display_name })}</span>}
      </div>
    </Link>
  );
}

/** Agents of the workspace with a search box and a status filter. */
export const AgentsList = observer(function AgentsList({ workspaceSlug }: { workspaceSlug: string }) {
  const { t } = useTranslation();
  const { fetchAgents, getWorkspaceAgentIds, getAgentById } = useAgent();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TStatusFilter>("active");

  const { isLoading } = useSWR(`WORKSPACE_AGENTS_${workspaceSlug}`, () => fetchAgents(workspaceSlug), {
    revalidateOnFocus: false,
  });

  const agentIds = getWorkspaceAgentIds(workspaceSlug);
  const agents = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (agentIds ?? [])
      .map((id) => getAgentById(id))
      .filter((agent): agent is IWorkspaceAgent => !!agent)
      .filter((agent) => statusFilter === "all" || agent.status === statusFilter)
      .filter(
        (agent) =>
          !search ||
          agent.name.toLowerCase().includes(search) ||
          agent.handle.includes(search) ||
          agent.summary.toLowerCase().includes(search)
      );
  }, [agentIds, getAgentById, query, statusFilter]);

  if (isLoading && !agentIds)
    return (
      <Loader className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
        <Loader.Item height="140px" />
        <Loader.Item height="140px" />
        <Loader.Item height="140px" />
      </Loader>
    );

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md bg-layer-3 p-0.5 text-12">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={cn(
                "rounded-sm px-2.5 py-1 text-secondary",
                statusFilter === key && "bg-layer-1 font-medium text-primary shadow-raised-100"
              )}
            >
              {t(key === "all" ? "agents.list.filter_all" : `agents.status.${key}`)}
            </button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("agents.list.search")}
          className="w-full sm:w-64"
        />
      </div>
      {agents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border-[0.5px] border-dashed border-subtle px-6 py-16 text-center">
          <Bot className="size-8 text-placeholder" />
          <p className="text-14 font-medium text-primary">
            {(agentIds ?? []).length === 0 ? t("agents.empty.title") : t("agents.empty.no_match")}
          </p>
          {(agentIds ?? []).length === 0 && (
            <p className="max-w-md text-13 text-tertiary">{t("agents.empty.description")}</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} workspaceSlug={workspaceSlug} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
});
