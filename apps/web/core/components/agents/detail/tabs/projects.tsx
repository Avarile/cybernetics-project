/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// hooks
import { useAgent } from "@/hooks/store/use-agent";
import { useProject } from "@/hooks/store/use-project";
// local
import type { TAgentTabProps } from "../types";

/** Projects the agent can be assigned work items in. */
export const AgentProjectsTab = observer(function AgentProjectsTab({ workspaceSlug, agent, canEdit }: TAgentTabProps) {
  const { t } = useTranslation();
  const { grantProjects, revokeProject } = useAgent();
  const { workspaceProjectIds, getProjectById } = useProject();
  const [selected, setSelected] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const available = (workspaceProjectIds ?? []).filter(
    (id) => !agent.project_ids.includes(id) && !getProjectById(id)?.archived_at
  );

  const run = async (action: () => Promise<void>) => {
    setIsBusy(true);
    try {
      await action();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("agents.toasts.error") });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-13 text-tertiary">{t("agents.projects.description")}</p>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="min-w-56 rounded-md border-[0.5px] border-subtle-1 bg-layer-1 px-2 py-1.5 text-13 text-primary"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">{t("agents.projects.select")}</option>
            {available.map((id) => (
              <option key={id} value={id}>
                {getProjectById(id)?.name}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            size="lg"
            disabled={!selected || isBusy}
            onClick={() =>
              run(async () => {
                await grantProjects(workspaceSlug, agent.id, [selected]);
                setSelected("");
              })
            }
          >
            {t("agents.projects.add")}
          </Button>
        </div>
      )}
      {agent.project_ids.length === 0 ? (
        <p className="text-13 text-placeholder">{t("agents.projects.empty")}</p>
      ) : (
        <ul className="divide-y divide-subtle rounded-lg border-[0.5px] border-subtle bg-layer-1">
          {agent.project_ids.map((id) => {
            const project = getProjectById(id);
            return (
              <li key={id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-13 text-primary">
                  {project?.name ?? id}
                  {project?.identifier && <span className="ml-2 text-12 text-tertiary">{project.identifier}</span>}
                </span>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="base"
                    disabled={isBusy}
                    onClick={() => run(() => revokeProject(workspaceSlug, agent.id, id))}
                  >
                    {t("agents.actions.remove")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
