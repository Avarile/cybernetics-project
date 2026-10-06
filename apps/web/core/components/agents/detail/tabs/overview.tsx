/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AGENT_HANDLE_REGEX, AGENT_SUMMARY_MAX_LENGTH } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Input, TextArea } from "@plane/ui";
// hooks
import { useMember } from "@/hooks/store/use-member";
// local components
import { MarkdownField } from "../../markdown-field";
import type { TAgentTabProps } from "../types";
import { AgentField, AgentValue } from "./field";

/** Identity, summary, profile and goal, plus quick stats. */
export const AgentOverviewTab = observer(function AgentOverviewTab({
  agent,
  draft,
  onChange,
  canEdit,
}: TAgentTabProps) {
  const { t } = useTranslation();
  const {
    getUserDetails,
    workspace: { workspaceMemberIds },
  } = useMember();
  const humanMemberIds = (workspaceMemberIds ?? []).filter((id) => !getUserDetails(id)?.is_bot);
  const emoji = draft.logo_props?.in_use === "emoji" ? (draft.logo_props.emoji?.value ?? "") : "";

  return (
    <div className="grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        {canEdit ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <AgentField label={t("agents.fields.name")}>
              <Input value={draft.name} maxLength={255} onChange={(e) => onChange({ name: e.target.value })} />
            </AgentField>
            <AgentField label={t("agents.fields.handle")} help={t("agents.fields.handle_help")}>
              <Input
                value={draft.handle}
                maxLength={48}
                hasError={!AGENT_HANDLE_REGEX.test(draft.handle)}
                onChange={(e) => onChange({ handle: e.target.value.toLowerCase() })}
              />
            </AgentField>
            <AgentField label={t("agents.fields.role_title")}>
              <Input
                value={draft.role_title}
                maxLength={255}
                placeholder={t("agents.fields.role_title_placeholder")}
                onChange={(e) => onChange({ role_title: e.target.value })}
              />
            </AgentField>
            <AgentField label={t("agents.fields.avatar_emoji")} help={t("agents.fields.avatar_emoji_help")}>
              <Input
                value={emoji}
                maxLength={8}
                onChange={(e) =>
                  onChange({
                    logo_props: e.target.value
                      ? { in_use: "emoji", emoji: { value: e.target.value } }
                      : { in_use: "icon" },
                  })
                }
              />
            </AgentField>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <AgentValue label={t("agents.fields.name")} value={agent.name} />
            <AgentValue label={t("agents.fields.handle")} value={`@${agent.handle}`} />
            <AgentValue label={t("agents.fields.role_title")} value={agent.role_title} />
          </div>
        )}
        {canEdit ? (
          <AgentField
            label={t("agents.fields.summary")}
            help={`${draft.summary.length} / ${AGENT_SUMMARY_MAX_LENGTH} · ${t("agents.fields.summary_help")}`}
          >
            <TextArea
              className="text-13"
              value={draft.summary}
              rows={2}
              maxLength={AGENT_SUMMARY_MAX_LENGTH}
              placeholder={t("agents.fields.summary_placeholder")}
              onChange={(e) => onChange({ summary: e.target.value })}
            />
          </AgentField>
        ) : (
          <AgentValue label={t("agents.fields.summary")} value={agent.summary} />
        )}
        <MarkdownField
          label={t("agents.fields.profile")}
          description={t("agents.fields.profile_help")}
          value={draft.profile_md}
          readOnly={!canEdit}
          rows={6}
          onChange={(value) => onChange({ profile_md: value })}
        />
        <MarkdownField
          label={t("agents.fields.goal")}
          description={t("agents.fields.goal_help")}
          value={draft.goal_md}
          readOnly={!canEdit}
          rows={6}
          placeholder={t("agents.fields.goal_placeholder")}
          onChange={(value) => onChange({ goal_md: value })}
        />
      </div>
      <div className="flex flex-col gap-4 rounded-lg border-[0.5px] border-subtle bg-layer-1 p-4 lg:self-start">
        <AgentValue label={t("agents.overview.open_items")} value={String(agent.assigned_open_count)} />
        <AgentValue label={t("agents.overview.projects")} value={String(agent.project_ids.length)} />
        <AgentValue label={t("agents.overview.version")} value={`v${agent.version}`} />
        {canEdit ? (
          <AgentField label={t("agents.fields.owner")} help={t("agents.fields.owner_help")}>
            <select
              className="rounded-md border-[0.5px] border-subtle-1 bg-layer-1 px-2 py-1.5 text-13 text-primary"
              value={draft.owner_id ?? ""}
              onChange={(e) => onChange({ owner_id: e.target.value || null })}
            >
              <option value="">{t("agents.fields.no_owner")}</option>
              {humanMemberIds.map((id) => (
                <option key={id} value={id}>
                  {getUserDetails(id)?.display_name}
                </option>
              ))}
            </select>
          </AgentField>
        ) : (
          <AgentValue label={t("agents.fields.owner")} value={agent.owner?.display_name} />
        )}
      </div>
    </div>
  );
});
