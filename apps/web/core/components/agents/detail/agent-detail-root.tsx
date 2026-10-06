/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { AGENT_DETAIL_TABS, EUserPermissionsLevel, EUserPermissions } from "@plane/constants";
import type { TAgentDetailTab } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TabNavigationItem, TabNavigationList } from "@plane/propel/tab-navigation";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IWorkspaceAgent, TAgentPayload } from "@plane/types";
import { Loader } from "@plane/ui";
// hooks
import { useAgent } from "@/hooks/store/use-agent";
import { useUserPermissions } from "@/hooks/store/user";
// local components
import { AgentAvatar } from "../agent-avatar";
import { AgentStatusPill } from "../agent-status-pill";
import { AgentSaveBar } from "./save-bar";
import { AgentContextTab } from "./tabs/context";
import { AgentHowItWorksTab } from "./tabs/how-it-works";
import { AgentOverviewTab } from "./tabs/overview";
import { AgentProjectsTab } from "./tabs/projects";
import { AgentSettingsTab } from "./tabs/settings";
import { AgentToolsTab } from "./tabs/tools";
import { AgentWorkItemsTab } from "./tabs/work-items";
import { AgentWorkflowTab } from "./tabs/workflow";
import type { TAgentTabProps } from "./types";

const TAB_COMPONENTS: Record<TAgentDetailTab, (props: TAgentTabProps) => React.ReactNode> = {
  overview: AgentOverviewTab,
  "how-it-works": AgentHowItWorksTab,
  workflow: AgentWorkflowTab,
  tools: AgentToolsTab,
  context: AgentContextTab,
  projects: AgentProjectsTab,
  "work-items": AgentWorkItemsTab,
  settings: AgentSettingsTab,
};

type Props = {
  workspaceSlug: string;
  agentId: string;
  tab: string | undefined;
};

/** Agent detail page: header, sub-tabs and the shared edit draft with its save bar. */
export const AgentDetailRoot = observer(function AgentDetailRoot({ workspaceSlug, agentId, tab }: Props) {
  const { t } = useTranslation();
  const { fetchAgent, getAgentById, updateAgent } = useAgent();
  const { allowPermissions } = useUserPermissions();
  const [changes, setChanges] = useState<TAgentPayload>({});
  const [isSaving, setIsSaving] = useState(false);

  const { error } = useSWR(`WORKSPACE_AGENT_${agentId}`, () => fetchAgent(workspaceSlug, agentId), {
    revalidateOnFocus: false,
  });
  const agent = getAgentById(agentId);
  const canEdit = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug);
  const activeTab = (AGENT_DETAIL_TABS.find((item) => item.key === tab)?.key ?? "overview") as TAgentDetailTab;

  const draft = useMemo(() => (agent ? ({ ...agent, ...changes } as IWorkspaceAgent) : undefined), [agent, changes]);
  const hasChanges = Object.keys(changes).length > 0;

  if (error) return <p className="p-6 text-13 text-danger-primary">{t("agents.detail.not_found")}</p>;
  if (!agent || !draft)
    return (
      <Loader className="flex flex-col gap-4 p-6">
        <Loader.Item height="48px" width="320px" />
        <Loader.Item height="320px" />
      </Loader>
    );

  const handleSave = async (changeNote: string) => {
    setIsSaving(true);
    try {
      const updated = await updateAgent(workspaceSlug, agent.id, { ...changes, change_note: changeNote });
      setChanges({});
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title:
          updated.version !== agent.version
            ? t("agents.toasts.saved_version", { version: updated.version })
            : t("agents.toasts.saved"),
      });
    } catch (err) {
      const data = err as Record<string, string[] | string> | undefined;
      const first = data ? Object.values(data)[0] : undefined;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("agents.toasts.error"),
        message: Array.isArray(first) ? first[0] : first,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const TabComponent = TAB_COMPONENTS[activeTab];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-4 px-6 pt-6">
        <div className="flex items-center gap-3">
          <AgentAvatar name={agent.name} logoProps={draft.logo_props} size="lg" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-18 font-semibold text-primary">{draft.name}</h2>
              <AgentStatusPill status={agent.status} />
              <span className="rounded-sm bg-layer-3 px-1.5 py-0.5 text-11 text-secondary">v{agent.version}</span>
            </div>
            <p className="truncate text-13 text-tertiary">
              @{draft.handle}
              {draft.role_title ? ` · ${draft.role_title}` : ""}
            </p>
          </div>
        </div>
        {canEdit && (
          <p className="rounded-md bg-layer-3 px-3 py-2 text-12 text-secondary">{t("agents.detail.shared_notice")}</p>
        )}
        <div className="overflow-x-auto">
          <TabNavigationList className="w-fit rounded-lg bg-layer-3 p-0.5">
            {AGENT_DETAIL_TABS.map((item) => (
              <Link key={item.key} href={`/${workspaceSlug}/agents/${agent.id}/${item.key}`}>
                <TabNavigationItem isActive={item.key === activeTab}>{t(item.i18n_label)}</TabNavigationItem>
              </Link>
            ))}
          </TabNavigationList>
        </div>
      </div>
      <div className="flex-1 px-6 py-6">
        <TabComponent
          workspaceSlug={workspaceSlug}
          agent={agent}
          draft={draft}
          changes={changes}
          onChange={(patch) => setChanges((prev) => ({ ...prev, ...patch }))}
          canEdit={canEdit}
        />
      </div>
      {canEdit && hasChanges && (
        <AgentSaveBar isSaving={isSaving} onDiscard={() => setChanges({})} onSave={handleSave} />
      )}
    </div>
  );
});
