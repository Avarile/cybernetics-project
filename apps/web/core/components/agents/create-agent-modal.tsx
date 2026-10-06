/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { AGENT_HANDLE_REGEX, AGENT_SUMMARY_MAX_LENGTH, agentHandleFromName } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, Input, ModalCore, TextArea } from "@plane/ui";
// hooks
import { useAgent } from "@/hooks/store/use-agent";
import { useAppRouter } from "@/hooks/use-app-router";

type Props = {
  workspaceSlug: string;
  isOpen: boolean;
  onClose: () => void;
};

const EMPTY = { name: "", handle: "", role_title: "", summary: "", goal_md: "" };

/** Collects the minimum to create an agent; the rest is edited on its detail page. */
export const CreateAgentModal = observer(function CreateAgentModal({ workspaceSlug, isOpen, onClose }: Props) {
  const { t } = useTranslation();
  const router = useAppRouter();
  const { createAgent } = useAgent();
  const [form, setForm] = useState(EMPTY);
  const [handleEdited, setHandleEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleIsValid = AGENT_HANDLE_REGEX.test(form.handle);
  const canSubmit = form.name.trim().length > 0 && handleIsValid && !isSubmitting;

  const handleClose = () => {
    setForm(EMPTY);
    setHandleEdited(false);
    setError(null);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const agent = await createAgent(workspaceSlug, { ...form, name: form.name.trim() });
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("agents.toasts.created", { name: agent.name }) });
      handleClose();
      router.push(`/${workspaceSlug}/agents/${agent.id}`);
    } catch (err) {
      const data = err as Record<string, string[] | string> | undefined;
      const message = data?.handle ?? data?.name ?? data?.error;
      setError(Array.isArray(message) ? message[0] : (message ?? t("agents.toasts.error")));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.TOP} width={EModalWidth.XL}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <div>
          <h3 className="text-16 font-medium text-primary">{t("agents.create.title")}</h3>
          <p className="text-13 text-tertiary">{t("agents.create.description")}</p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-13 font-medium text-secondary">{t("agents.fields.name")}</span>
          <Input
            value={form.name}
            maxLength={255}
            placeholder={t("agents.fields.name_placeholder")}
            onChange={(e) => {
              const name = e.target.value;
              setForm((prev) => ({ ...prev, name, handle: handleEdited ? prev.handle : agentHandleFromName(name) }));
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-13 font-medium text-secondary">{t("agents.fields.handle")}</span>
          <div className="flex items-center gap-1">
            <span className="text-13 text-tertiary">@</span>
            <Input
              value={form.handle}
              maxLength={48}
              hasError={form.handle.length > 0 && !handleIsValid}
              className="w-full"
              onChange={(e) => {
                setHandleEdited(true);
                setForm((prev) => ({ ...prev, handle: e.target.value.toLowerCase() }));
              }}
            />
          </div>
          <span className="text-11 text-tertiary">{t("agents.fields.handle_help")}</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-13 font-medium text-secondary">{t("agents.fields.role_title")}</span>
          <Input
            value={form.role_title}
            maxLength={255}
            placeholder={t("agents.fields.role_title_placeholder")}
            onChange={(e) => setForm((prev) => ({ ...prev, role_title: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-13 font-medium text-secondary">{t("agents.fields.summary")}</span>
          <TextArea
            className="text-13"
            value={form.summary}
            rows={2}
            maxLength={AGENT_SUMMARY_MAX_LENGTH}
            placeholder={t("agents.fields.summary_placeholder")}
            onChange={(e) => setForm((prev) => ({ ...prev, summary: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-13 font-medium text-secondary">{t("agents.fields.goal")}</span>
          <TextArea
            className="text-13"
            value={form.goal_md}
            rows={3}
            placeholder={t("agents.fields.goal_placeholder")}
            onChange={(e) => setForm((prev) => ({ ...prev, goal_md: e.target.value }))}
          />
        </label>
        {error && <p className="text-13 text-danger-primary">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="lg" type="button" onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button variant="primary" size="lg" type="submit" disabled={!canSubmit} loading={isSubmitting}>
            {t("agents.create.submit")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
