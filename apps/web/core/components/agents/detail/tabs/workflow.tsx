/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ArrowDown, ArrowUp, ShieldCheck, Trash2 } from "lucide-react";
import { AGENT_WORKFLOW_MAX_STEPS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { PlusIcon } from "@plane/propel/icons";
import type { TAgentWorkflowStep } from "@plane/types";
import { Input, TextArea, ToggleSwitch } from "@plane/ui";
// local components
import { MarkdownRenderer } from "@/components/ui/markdown-to-component";
import type { TAgentTabProps } from "../types";

const newStep = (): TAgentWorkflowStep => ({
  id: crypto.randomUUID(),
  title: "",
  description_md: "",
  expected_output_md: "",
  requires_approval: false,
});

function ReadOnlyStep({ step, index }: { step: TAgentWorkflowStep; index: number }) {
  const { t } = useTranslation();
  return (
    <li className="flex gap-3">
      <span className="grid size-6 flex-shrink-0 place-items-center rounded-full bg-layer-3 text-12 font-medium text-secondary">
        {index + 1}
      </span>
      <div className="flex flex-col gap-1 pb-4">
        <p className="flex items-center gap-2 text-14 font-medium text-primary">
          {step.title}
          {step.requires_approval && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-warning-subtle px-1.5 text-11 text-warning-primary">
              <ShieldCheck className="size-3" />
              {t("agents.workflow.requires_approval")}
            </span>
          )}
        </p>
        {step.description_md && <MarkdownRenderer markdown={step.description_md} />}
        {step.expected_output_md && (
          <p className="text-12 text-tertiary">
            {t("agents.workflow.expected_output")}: {step.expected_output_md}
          </p>
        )}
      </div>
    </li>
  );
}

/** Ordered workflow steps the agent follows; steps can require human approval. */
export function AgentWorkflowTab({ draft, onChange, canEdit }: TAgentTabProps) {
  const { t } = useTranslation();
  const steps = draft.workflow;

  const update = (next: TAgentWorkflowStep[]) => onChange({ workflow: next });
  const patchStep = (index: number, patch: Partial<TAgentWorkflowStep>) =>
    update(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  };

  if (!canEdit)
    return steps.length ? (
      <ol className="flex max-w-3xl flex-col">
        {steps.map((step, index) => (
          <ReadOnlyStep key={step.id} step={step} index={index} />
        ))}
      </ol>
    ) : (
      <p className="text-13 text-placeholder">{t("agents.workflow.empty")}</p>
    );

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <p className="text-13 text-tertiary">{t("agents.workflow.description")}</p>
      {steps.map((step, index) => (
        <div key={step.id} className="flex flex-col gap-2 rounded-lg border-[0.5px] border-subtle bg-layer-1 p-3">
          <div className="flex items-center gap-2">
            <span className="grid size-6 flex-shrink-0 place-items-center rounded-full bg-layer-3 text-12 font-medium text-secondary">
              {index + 1}
            </span>
            <Input
              value={step.title}
              maxLength={255}
              hasError={!step.title.trim()}
              placeholder={t("agents.workflow.title_placeholder")}
              className="flex-1"
              onChange={(e) => patchStep(index, { title: e.target.value })}
            />
            <button
              type="button"
              aria-label={t("agents.workflow.move_up")}
              disabled={index === 0}
              onClick={() => move(index, -1)}
              className="rounded-sm p-1 text-tertiary hover:bg-layer-transparent-hover disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
            <button
              type="button"
              aria-label={t("agents.workflow.move_down")}
              disabled={index === steps.length - 1}
              onClick={() => move(index, 1)}
              className="rounded-sm p-1 text-tertiary hover:bg-layer-transparent-hover disabled:opacity-40"
            >
              <ArrowDown className="size-4" />
            </button>
            <button
              type="button"
              aria-label={t("agents.actions.remove")}
              onClick={() => update(steps.filter((_, i) => i !== index))}
              className="rounded-sm p-1 text-danger-primary hover:bg-danger-subtle"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <TextArea
            className="text-13"
            value={step.description_md}
            rows={3}
            maxLength={5000}
            placeholder={t("agents.workflow.description_placeholder")}
            onChange={(e) => patchStep(index, { description_md: e.target.value })}
          />
          <Input
            value={step.expected_output_md}
            maxLength={5000}
            placeholder={t("agents.workflow.expected_output_placeholder")}
            onChange={(e) => patchStep(index, { expected_output_md: e.target.value })}
          />
          <div className="flex items-center gap-2 text-13 text-secondary">
            <ToggleSwitch
              value={step.requires_approval}
              onChange={() => patchStep(index, { requires_approval: !step.requires_approval })}
            />
            {t("agents.workflow.requires_approval_help")}
          </div>
        </div>
      ))}
      <Button
        variant="secondary"
        size="lg"
        className="w-fit"
        disabled={steps.length >= AGENT_WORKFLOW_MAX_STEPS}
        onClick={() => update([...steps, newStep()])}
      >
        <PlusIcon className="size-3.5" />
        {t("agents.workflow.add_step")}
      </Button>
    </div>
  );
}
