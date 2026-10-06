/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { AGENT_MARKDOWN_MAX_LENGTH } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TextArea } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { MarkdownRenderer } from "@/components/ui/markdown-to-component";

type Props = {
  label: string;
  description?: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  rows?: number;
  maxLength?: number;
};

/** Markdown text area with a write/preview toggle; read-only users only see the preview. */
export function MarkdownField(props: Props) {
  const {
    label,
    description,
    value,
    onChange,
    placeholder,
    readOnly = false,
    rows = 8,
    maxLength = AGENT_MARKDOWN_MAX_LENGTH,
  } = props;
  const { t } = useTranslation();
  const [mode, setMode] = useState<"write" | "preview">(readOnly ? "preview" : "write");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-13 font-medium text-primary">{label}</p>
          {description && <p className="text-12 text-tertiary">{description}</p>}
        </div>
        {!readOnly && (
          <div className="flex rounded-md bg-layer-3 p-0.5 text-12">
            {(["write", "preview"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-secondary",
                  mode === key && "bg-layer-1 font-medium text-primary shadow-raised-100"
                )}
              >
                {t(key === "write" ? "agents.markdown.write" : "agents.markdown.preview")}
              </button>
            ))}
          </div>
        )}
      </div>
      {mode === "write" && !readOnly ? (
        <>
          <TextArea
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder}
            rows={rows}
            maxLength={maxLength}
            className="w-full font-code text-13"
          />
          <p className="self-end text-11 text-placeholder">
            {value.length.toLocaleString()} / {maxLength.toLocaleString()}
          </p>
        </>
      ) : (
        <div className="min-h-16 rounded-md border-[0.5px] border-subtle bg-layer-1 px-3 py-2">
          {value.trim() ? (
            <MarkdownRenderer markdown={value} />
          ) : (
            <p className="text-13 text-placeholder">{t("agents.markdown.empty")}</p>
          )}
        </div>
      )}
    </div>
  );
}
