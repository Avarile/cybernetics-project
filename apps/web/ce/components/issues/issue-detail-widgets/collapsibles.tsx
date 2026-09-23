/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { EIssueServiceType } from "@plane/types";
import type { TIssueServiceType, TWorkItemWidgets } from "@plane/types";
// plane web imports
import { CyberneticsRecordsCollapsible } from "@/plane-web/components/cybernetics-data/widget/root";

export type TWorkItemAdditionalWidgetCollapsiblesProps = {
  disabled: boolean;
  hideWidgets: TWorkItemWidgets[];
  issueServiceType: TIssueServiceType;
  projectId: string;
  workItemId: string;
  workspaceSlug: string;
};

export function WorkItemAdditionalWidgetCollapsibles(props: TWorkItemAdditionalWidgetCollapsiblesProps) {
  const { disabled, hideWidgets, issueServiceType, projectId, workItemId, workspaceSlug } = props;

  if (issueServiceType !== EIssueServiceType.ISSUES || hideWidgets.includes("cybernetics-records")) return null;

  return (
    <CyberneticsRecordsCollapsible
      workspaceSlug={workspaceSlug}
      projectId={projectId}
      issueId={workItemId}
      disabled={disabled}
      issueServiceType={issueServiceType}
    />
  );
}
