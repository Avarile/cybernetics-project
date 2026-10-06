/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Loader } from "@plane/ui";
import { cn, copyTextToClipboard, renderFormattedDate } from "@plane/utils";
// services
import { AgentService } from "@/services/agent.service";
// local
import type { TAgentTabProps } from "../types";

const agentService = new AgentService();
const GROUPS = ["open", "completed", "cancelled"] as const;

/** Work items assigned to the agent; each can be copied as a task brief for an LLM. */
export function AgentWorkItemsTab({ workspaceSlug, agent }: TAgentTabProps) {
  const { t } = useTranslation();
  const [group, setGroup] = useState<(typeof GROUPS)[number]>("open");
  const { data, isLoading } = useSWR(["AGENT_WORK_ITEMS", agent.id, group], () =>
    agentService.listWorkItems(workspaceSlug, agent.id, group)
  );

  const copyBrief = async (key: string) => {
    try {
      const brief = await agentService.getTaskBrief(workspaceSlug, agent.id, key);
      await copyTextToClipboard(brief);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("agents.work_items.brief_copied", { key }) });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("agents.toasts.error") });
    }
  };

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex w-fit rounded-md bg-layer-3 p-0.5 text-12">
        {GROUPS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setGroup(key)}
            className={cn(
              "rounded-sm px-2.5 py-1 text-secondary",
              group === key && "bg-layer-1 font-medium text-primary shadow-raised-100"
            )}
          >
            {t(`agents.work_items.${key}`)}
          </button>
        ))}
      </div>
      {isLoading ? (
        <Loader className="flex flex-col gap-2">
          <Loader.Item height="36px" />
          <Loader.Item height="36px" />
        </Loader>
      ) : !data?.length ? (
        <p className="text-13 text-placeholder">{t("agents.work_items.empty")}</p>
      ) : (
        <ul className="divide-y divide-subtle rounded-lg border-[0.5px] border-subtle bg-layer-1">
          {data.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <Link
                href={`/${workspaceSlug}/browse/${item.key}/`}
                className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
              >
                <span className="flex-shrink-0 text-12 text-tertiary">{item.key}</span>
                <span className="truncate text-13 text-primary">{item.name}</span>
              </Link>
              {item.state_name && (
                <span className="rounded-sm bg-layer-3 px-1.5 py-0.5 text-11 text-secondary">{item.state_name}</span>
              )}
              {item.priority && item.priority !== "none" && (
                <span className="text-12 text-tertiary capitalize">{item.priority}</span>
              )}
              {item.target_date && (
                <span className="text-12 text-tertiary">{renderFormattedDate(item.target_date)}</span>
              )}
              <Button variant="ghost" size="base" onClick={() => copyBrief(item.key)}>
                {t("agents.work_items.copy_brief")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
