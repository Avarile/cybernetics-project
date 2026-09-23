/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { CYBERNETICS_INTEGRATION_KEY, ISSUE_CYBERNETICS_RECORDS_KEY } from "@plane/constants";
import type { TIssueServiceType } from "@plane/types";
import { Collapsible } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// plane web imports
import { useCyberneticsData } from "@/plane-web/hooks/store/use-cybernetics-data";
// local imports
import { CyberneticsRecordsCollapsibleContent } from "./content";
import { CyberneticsRecordsCollapsibleTitle } from "./title";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  issueServiceType: TIssueServiceType;
};

export const CyberneticsRecordsCollapsible = observer(function CyberneticsRecordsCollapsible(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled, issueServiceType } = props;
  // store hooks
  const { openWidgets, toggleOpenWidget } = useIssueDetail(issueServiceType);
  const { fetchIntegration, fetchIssueRecords, getIntegration, getRecordCountByIssueId } = useCyberneticsData();
  // derived values
  // records are only fetched once the project is known to be configured, so unconfigured projects cost no extra
  // request per work item. Disconnecting deletes the configuration, so its saved snapshots are hidden too.
  const isConfigured = !!getIntegration(projectId)?.is_configured;
  // fetch
  useSWR(
    workspaceSlug && projectId ? CYBERNETICS_INTEGRATION_KEY(projectId) : null,
    workspaceSlug && projectId ? () => fetchIntegration(workspaceSlug, projectId) : null,
    { revalidateOnFocus: false }
  );
  useSWR(
    isConfigured && workspaceSlug && projectId && issueId ? ISSUE_CYBERNETICS_RECORDS_KEY(issueId) : null,
    isConfigured && workspaceSlug && projectId && issueId
      ? () => fetchIssueRecords(workspaceSlug, projectId, issueId)
      : null,
    { revalidateOnFocus: false }
  );
  const recordsCount = getRecordCountByIssueId(issueId);
  const isCollapsibleOpen = openWidgets.includes("cybernetics-records");

  if (!isConfigured || recordsCount === 0) return null;

  return (
    <Collapsible
      isOpen={isCollapsibleOpen}
      onToggle={() => toggleOpenWidget("cybernetics-records")}
      title={
        <CyberneticsRecordsCollapsibleTitle
          isOpen={isCollapsibleOpen}
          projectId={projectId}
          issueId={issueId}
          disabled={disabled}
        />
      }
      buttonClassName="w-full"
    >
      <CyberneticsRecordsCollapsibleContent
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        disabled={disabled}
      />
    </Collapsible>
  );
});
