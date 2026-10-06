/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { PlusIcon } from "@plane/propel/icons";
import type { TAgentTool } from "@plane/types";
import { Input, TextArea } from "@plane/ui";
// local components
import type { TAgentTabProps } from "../types";
import { AgentField } from "./field";

/** Descriptive tools list and advisory runtime hints for the consuming LLM platform. */
export function AgentToolsTab({ draft, onChange, canEdit }: TAgentTabProps) {
  const { t } = useTranslation();
  const [hintsText, setHintsText] = useState(JSON.stringify(draft.runtime_hints ?? {}, null, 2));
  const [hintsError, setHintsError] = useState<string | null>(null);
  const tools = draft.tools;

  const patchTool = (index: number, patch: Partial<TAgentTool>) =>
    onChange({ tools: tools.map((tool, i) => (i === index ? { ...tool, ...patch } : tool)) });

  const handleHints = (value: string) => {
    setHintsText(value);
    try {
      const parsed = JSON.parse(value || "{}");
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) throw new Error();
      setHintsError(null);
      onChange({ runtime_hints: parsed });
    } catch {
      setHintsError(t("agents.tools.hints_invalid"));
    }
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-13 font-medium text-primary">{t("agents.tools.title")}</p>
          <p className="text-12 text-tertiary">{t("agents.tools.description")}</p>
        </div>
        {tools.length === 0 && <p className="text-13 text-placeholder">{t("agents.tools.empty")}</p>}
        {tools.map((tool, index) =>
          canEdit ? (
            <div key={index} className="flex flex-col gap-2 rounded-lg border-[0.5px] border-subtle bg-layer-1 p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={tool.name}
                  maxLength={128}
                  hasError={!tool.name.trim()}
                  placeholder={t("agents.tools.name_placeholder")}
                  className="flex-1"
                  onChange={(e) => patchTool(index, { name: e.target.value })}
                />
                <button
                  type="button"
                  aria-label={t("agents.actions.remove")}
                  onClick={() => onChange({ tools: tools.filter((_, i) => i !== index) })}
                  className="rounded-sm p-1 text-danger-primary hover:bg-danger-subtle"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <Input
                value={tool.description}
                maxLength={1000}
                placeholder={t("agents.tools.description_placeholder")}
                onChange={(e) => patchTool(index, { description: e.target.value })}
              />
              <TextArea
                className="text-13"
                value={tool.usage_md}
                rows={2}
                maxLength={5000}
                placeholder={t("agents.tools.usage_placeholder")}
                onChange={(e) => patchTool(index, { usage_md: e.target.value })}
              />
            </div>
          ) : (
            <div key={index} className="rounded-lg border-[0.5px] border-subtle bg-layer-1 p-3">
              <p className="text-13 font-medium text-primary">{tool.name}</p>
              {tool.description && <p className="text-13 text-secondary">{tool.description}</p>}
              {tool.usage_md && <p className="mt-1 text-12 whitespace-pre-wrap text-tertiary">{tool.usage_md}</p>}
            </div>
          )
        )}
        {canEdit && (
          <Button
            variant="secondary"
            size="lg"
            className="w-fit"
            disabled={tools.length >= 50}
            onClick={() => onChange({ tools: [...tools, { name: "", description: "", usage_md: "" }] })}
          >
            <PlusIcon className="size-3.5" />
            {t("agents.tools.add")}
          </Button>
        )}
      </div>
      <AgentField label={t("agents.tools.hints_title")} help={t("agents.tools.hints_help")}>
        {canEdit ? (
          <>
            <TextArea
              value={hintsText}
              rows={6}
              className="font-code text-13"
              hasError={!!hintsError}
              onChange={(e) => handleHints(e.target.value)}
            />
            {hintsError && <span className="text-12 text-danger-primary">{hintsError}</span>}
          </>
        ) : (
          <pre className="rounded-md bg-layer-3 p-3 text-12 text-secondary">
            {JSON.stringify(draft.runtime_hints ?? {}, null, 2)}
          </pre>
        )}
      </AgentField>
    </div>
  );
}
