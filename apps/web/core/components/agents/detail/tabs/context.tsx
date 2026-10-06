/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AGENT_CONTEXT_MAX_BYTES, API_BASE_URL } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TAgentRevision } from "@plane/types";
import { cn, copyTextToClipboard, renderFormattedDate } from "@plane/utils";
// components
import { buildEndpointUrl } from "@/components/settings/profile/content/pages/mcp/helpers";
// services
import { AgentService } from "@/services/agent.service";
// local
import type { TAgentTabProps } from "../types";

const agentService = new AgentService();
const PREVIEW_DEBOUNCE_MS = 400;

function CodeBlock({ title, text }: { title: string; text: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <p className="text-12 font-medium text-secondary">{title}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            copyTextToClipboard(text).then(() =>
              setToast({ type: TOAST_TYPE.SUCCESS, title: t("agents.context.copied") })
            )
          }
        >
          {t("agents.actions.copy")}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md bg-layer-3 p-3 font-code text-12 whitespace-pre-wrap text-secondary">
        {text}
      </pre>
    </div>
  );
}

/** Exactly what an LLM platform receives for this agent, its version history and how to connect. */
export function AgentContextTab({ workspaceSlug, agent, changes, canEdit }: TAgentTabProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<"markdown" | "json">("markdown");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [debouncedChanges, setDebouncedChanges] = useState(changes);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedChanges(changes), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [changes]);

  // Admins preview unsaved edits; members read the saved context.
  const { data: preview, error: previewError } = useSWR(
    canEdit ? ["AGENT_CONTEXT_PREVIEW", agent.id, agent.version, JSON.stringify(debouncedChanges)] : null,
    () => agentService.previewContext(workspaceSlug, agent.id, debouncedChanges),
    { revalidateOnFocus: false, keepPreviousData: true }
  );
  const { data: savedMarkdown } = useSWR(
    !canEdit || selectedVersion ? ["AGENT_CONTEXT", agent.id, agent.version, selectedVersion] : null,
    () => agentService.getContext(workspaceSlug, agent.id, selectedVersion ?? undefined),
    { revalidateOnFocus: false }
  );
  const { data: revisions } = useSWR<TAgentRevision[]>(
    ["AGENT_REVISIONS", agent.id, agent.version],
    () => agentService.listRevisions(workspaceSlug, agent.id),
    { revalidateOnFocus: false }
  );

  const markdown = selectedVersion || !canEdit ? (savedMarkdown ?? "") : (preview?.markdown ?? "");
  const shownText =
    format === "json" && preview && !selectedVersion && canEdit ? JSON.stringify(preview.json, null, 2) : markdown;
  const sizeBytes = new TextEncoder().encode(markdown).length;
  const nearLimit = sizeBytes > AGENT_CONTEXT_MAX_BYTES * 0.8;

  const apiBase = (API_BASE_URL || (typeof window === "undefined" ? "" : window.location.origin)).replace(/\/$/, "");
  const restUrl = `${apiBase}/api/v1/workspaces/${workspaceSlug}/agents/${agent.handle}/context/?format=markdown`;

  return (
    <div className="grid max-w-6xl grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="flex flex-col gap-3 xl:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-13 font-medium text-primary">
              {selectedVersion
                ? t("agents.context.title_version", { version: selectedVersion })
                : t("agents.context.title")}
            </p>
            <p className="text-12 text-tertiary">
              {preview?.changed && !selectedVersion ? t("agents.context.unsaved_preview") : t("agents.context.help")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && !selectedVersion && (
              <div className="flex rounded-md bg-layer-3 p-0.5 text-12">
                {(["markdown", "json"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFormat(key)}
                    className={cn(
                      "rounded-sm px-2 py-0.5 text-secondary",
                      format === key && "bg-layer-1 font-medium text-primary shadow-raised-100"
                    )}
                  >
                    {key === "markdown" ? "Markdown" : "JSON"}
                  </button>
                ))}
              </div>
            )}
            <span className={cn("text-12", nearLimit ? "text-danger-primary" : "text-tertiary")}>
              {t("agents.context.size", {
                kb: (sizeBytes / 1024).toFixed(1),
                tokens: Math.ceil(sizeBytes / 4).toLocaleString(),
              })}
            </span>
          </div>
        </div>
        {previewError && canEdit && !selectedVersion ? (
          <p className="text-13 text-danger-primary">{t("agents.context.preview_error")}</p>
        ) : (
          <CodeBlock title={t("agents.context.rendered")} text={shownText} />
        )}
      </div>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-13 font-medium text-primary">{t("agents.context.versions")}</p>
          <ul className="flex flex-col gap-1">
            {(revisions ?? []).map((revision) => {
              const isCurrent = revision.version === agent.version;
              const isSelected = selectedVersion === revision.version || (!selectedVersion && isCurrent);
              return (
                <li key={revision.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedVersion(isCurrent ? null : revision.version)}
                    className={cn(
                      "flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-layer-transparent-hover",
                      isSelected && "bg-layer-transparent-selected"
                    )}
                  >
                    <span className="text-13 text-primary">
                      v{revision.version}
                      {isCurrent ? ` · ${t("agents.context.current")}` : ""}
                    </span>
                    <span className="text-11 text-tertiary">
                      {renderFormattedDate(revision.created_at)}
                      {revision.created_by_name ? ` · ${revision.created_by_name}` : ""}
                    </span>
                    {revision.change_note && <span className="text-12 text-secondary">{revision.change_note}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-13 font-medium text-primary">{t("agents.context.connect_title")}</p>
            <p className="text-12 text-tertiary">
              {t("agents.context.connect_help")}{" "}
              <Link href="/settings/profile/mcp" className="text-accent-primary underline">
                {t("agents.context.connect_settings")}
              </Link>
            </p>
          </div>
          <CodeBlock title={t("agents.context.mcp_server")} text={buildEndpointUrl()} />
          <CodeBlock
            title={t("agents.context.llm_prompt")}
            text={t("agents.context.llm_prompt_example", { handle: agent.handle, workspace: workspaceSlug })}
          />
          <CodeBlock title="REST" text={`curl -H "X-Api-Key: <YOUR_TOKEN>" \\\n  "${restUrl}"`} />
        </div>
      </div>
    </div>
  );
}
