/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { EIssueServiceType } from "@plane/types";
import type { TIssueServiceType, TWorkItemWidgets } from "@plane/types";
// plane web imports
import { CyberneticsDataBrowserModal } from "@/plane-web/components/cybernetics-data/browser/modal";

export type TWorkItemAdditionalWidgetModalsProps = {
  hideWidgets: TWorkItemWidgets[];
  issueServiceType: TIssueServiceType;
  projectId: string;
  workItemId: string;
  workspaceSlug: string;
};

export function WorkItemAdditionalWidgetModals(props: TWorkItemAdditionalWidgetModalsProps) {
  const { hideWidgets, issueServiceType, projectId, workItemId, workspaceSlug } = props;

  if (issueServiceType !== EIssueServiceType.ISSUES || hideWidgets.includes("cybernetics-records")) return null;

  return <CyberneticsDataBrowserModal workspaceSlug={workspaceSlug} projectId={projectId} workItemId={workItemId} />;
}
