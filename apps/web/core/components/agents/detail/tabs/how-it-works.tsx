/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { useTranslation } from "@plane/i18n";
import { CloseIcon } from "@plane/propel/icons";
import { Input } from "@plane/ui";
// local components
import { MarkdownField } from "../../markdown-field";
import type { TAgentTabProps } from "../types";
import { AgentField } from "./field";

/** "How it works" and operating instructions, plus capability tags. */
export function AgentHowItWorksTab({ draft, onChange, canEdit }: TAgentTabProps) {
  const { t } = useTranslation();
  const [capability, setCapability] = useState("");

  const addCapability = () => {
    const value = capability.trim();
    if (value && !draft.capabilities.includes(value) && draft.capabilities.length < 50)
      onChange({ capabilities: [...draft.capabilities, value] });
    setCapability("");
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <MarkdownField
        label={t("agents.fields.how_it_works")}
        description={t("agents.fields.how_it_works_help")}
        value={draft.how_it_works_md}
        readOnly={!canEdit}
        rows={10}
        onChange={(value) => onChange({ how_it_works_md: value })}
      />
      <MarkdownField
        label={t("agents.fields.instructions")}
        description={t("agents.fields.instructions_help")}
        value={draft.instructions_md}
        readOnly={!canEdit}
        rows={12}
        onChange={(value) => onChange({ instructions_md: value })}
      />
      <AgentField label={t("agents.fields.capabilities")} help={t("agents.fields.capabilities_help")}>
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.capabilities.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 rounded-sm bg-layer-3 px-1.5 py-0.5 text-12 text-secondary"
            >
              {item}
              {canEdit && (
                <button
                  type="button"
                  aria-label={t("agents.actions.remove")}
                  onClick={() => onChange({ capabilities: draft.capabilities.filter((c) => c !== item) })}
                >
                  <CloseIcon className="size-3" />
                </button>
              )}
            </span>
          ))}
          {canEdit && (
            <Input
              value={capability}
              maxLength={64}
              placeholder={t("agents.fields.capability_placeholder")}
              className="w-48"
              onChange={(e) => setCapability(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCapability();
                }
              }}
              onBlur={addCapability}
            />
          )}
          {!canEdit && draft.capabilities.length === 0 && <span className="text-13 text-placeholder">—</span>}
        </div>
      </AgentField>
    </div>
  );
}
