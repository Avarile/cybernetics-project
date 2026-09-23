/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
import { Database } from "lucide-react";
// plane imports
import { CYBERNETICS_INTEGRATION_KEY, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EIssueServiceType } from "@plane/types";
import type { TIssueServiceType, TWorkItemWidgets } from "@plane/types";
// components
import { IssueDetailWidgetButton } from "@/components/issues/issue-detail-widgets/widget-button";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// plane web imports
import { CyberneticsDataActionButton } from "@/plane-web/components/cybernetics-data/widget/action-button";
import { useCyberneticsData } from "@/plane-web/hooks/store/use-cybernetics-data";

export type TWorkItemAdditionalWidgetActionButtonsProps = {
  disabled: boolean;
  hideWidgets: TWorkItemWidgets[];
  issueServiceType: TIssueServiceType;
  projectId: string;
  workItemId: string;
  workspaceSlug: string;
};

export const WorkItemAdditionalWidgetActionButtons = observer(function WorkItemAdditionalWidgetActionButtons(
  props: TWorkItemAdditionalWidgetActionButtonsProps
) {
  const { disabled, hideWidgets, issueServiceType, projectId, workItemId, workspaceSlug } = props;
  // translation
  const { t } = useTranslation();
  // store hooks
  const { getIntegration, fetchIntegration, isIntegrationActive } = useCyberneticsData();
  const { allowPermissions } = useUserPermissions();
  // derived values
  const isSupported = issueServiceType === EIssueServiceType.ISSUES && !hideWidgets.includes("cybernetics-records");
  // fetch
  useSWR(
    isSupported && workspaceSlug && projectId ? CYBERNETICS_INTEGRATION_KEY(projectId) : null,
    isSupported && workspaceSlug && projectId ? () => fetchIntegration(workspaceSlug, projectId) : null,
    { revalidateOnFocus: false }
  );

  if (!isSupported) return null;
  const integration = getIntegration(projectId);
  if (!integration) return null;
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const isMember = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  // guests never browse; non-admins only see the button when the integration is active
  if (!isMember) return null;
  if (!isIntegrationActive(projectId) && !isAdmin) return null;

  return (
    <CyberneticsDataActionButton
      workItemId={workItemId}
      disabled={disabled}
      customButton={
        <IssueDetailWidgetButton
          title={t("cybernetics_data.widget.button")}
          icon={<Database className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />}
          disabled={disabled}
        />
      }
    />
  );
});
