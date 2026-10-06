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
import { Input, ToggleSwitch } from "@plane/ui";
// hooks
import { useAgent } from "@/hooks/store/use-agent";
import { useAppRouter } from "@/hooks/use-app-router";
// local
import type { TAgentTabProps } from "../types";

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-subtle py-4 last:border-b-0">
      <div className="max-w-xl">
        <p className="text-13 font-medium text-primary">{title}</p>
        <p className="text-12 text-tertiary">{description}</p>
      </div>
      {children}
    </div>
  );
}

/** Assignment availability, pause/resume, archive/restore and delete. */
export const AgentSettingsTab = observer(function AgentSettingsTab({ workspaceSlug, agent, canEdit }: TAgentTabProps) {
  const { t } = useTranslation();
  const router = useAppRouter();
  const { updateAgent, archiveAgent, restoreAgent, deleteAgent } = useAgent();
  const [isBusy, setIsBusy] = useState(false);
  const [confirmHandle, setConfirmHandle] = useState("");

  if (!canEdit) return <p className="text-13 text-tertiary">{t("agents.settings.admin_only")}</p>;

  const run = async (action: () => Promise<unknown>, successKey: string) => {
    setIsBusy(true);
    try {
      await action();
      setToast({ type: TOAST_TYPE.SUCCESS, title: t(successKey) });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("agents.toasts.error") });
    } finally {
      setIsBusy(false);
    }
  };

  const isArchived = agent.status === "archived";

  return (
    <div className="flex max-w-3xl flex-col">
      <Section title={t("agents.settings.accept_title")} description={t("agents.settings.accept_description")}>
        <ToggleSwitch
          value={agent.accept_assignments}
          disabled={isBusy || isArchived}
          onChange={() =>
            run(
              () => updateAgent(workspaceSlug, agent.id, { accept_assignments: !agent.accept_assignments }),
              "agents.toasts.saved"
            )
          }
        />
      </Section>
      {!isArchived && (
        <Section title={t("agents.settings.pause_title")} description={t("agents.settings.pause_description")}>
          <Button
            variant="secondary"
            size="lg"
            disabled={isBusy}
            onClick={() =>
              run(
                () => updateAgent(workspaceSlug, agent.id, { status: agent.status === "active" ? "paused" : "active" }),
                "agents.toasts.saved"
              )
            }
          >
            {agent.status === "active" ? t("agents.settings.pause") : t("agents.settings.resume")}
          </Button>
        </Section>
      )}
      <Section
        title={isArchived ? t("agents.settings.restore_title") : t("agents.settings.archive_title")}
        description={isArchived ? t("agents.settings.restore_description") : t("agents.settings.archive_description")}
      >
        <Button
          variant="secondary"
          size="lg"
          disabled={isBusy}
          onClick={() =>
            isArchived
              ? run(() => restoreAgent(workspaceSlug, agent.id), "agents.toasts.restored")
              : run(() => archiveAgent(workspaceSlug, agent.id), "agents.toasts.archived")
          }
        >
          {isArchived ? t("agents.settings.restore") : t("agents.settings.archive")}
        </Button>
      </Section>
      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-danger-strong p-4">
        <div>
          <p className="text-13 font-medium text-danger-primary">{t("agents.settings.delete_title")}</p>
          <p className="text-12 text-tertiary">{t("agents.settings.delete_description", { handle: agent.handle })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            value={confirmHandle}
            placeholder={agent.handle}
            onChange={(e) => setConfirmHandle(e.target.value)}
            className="w-56"
          />
          <Button
            variant="error-fill"
            size="lg"
            disabled={isBusy || confirmHandle !== agent.handle}
            onClick={() =>
              run(async () => {
                await deleteAgent(workspaceSlug, agent.id);
                router.push(`/${workspaceSlug}/agents`);
              }, "agents.toasts.deleted")
            }
          >
            {t("agents.settings.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
});
