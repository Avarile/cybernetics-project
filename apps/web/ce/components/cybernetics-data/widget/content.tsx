/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { Info } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// hooks
import { useUser, useUserPermissions } from "@/hooks/store/user";
// plane web imports
import { useCyberneticsData } from "@/plane-web/hooks/store/use-cybernetics-data";
// local imports
import { CyberneticsRecordItem } from "./record-item";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
};

export const CyberneticsRecordsCollapsibleContent = observer(function CyberneticsRecordsCollapsibleContent(
  props: Props
) {
  const { workspaceSlug, projectId, issueId, disabled } = props;
  // translation
  const { t } = useTranslation();
  // store hooks
  const { getRecordsByIssueId, isIntegrationActive } = useCyberneticsData();
  const { allowPermissions } = useUserPermissions();
  const { data: currentUser } = useUser();
  // derived values
  const records = getRecordsByIssueId(issueId);
  const isActive = isIntegrationActive(projectId);
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const isMember = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );

  return (
    <div className="flex flex-col gap-2 py-2">
      {!isActive && (
        <p className="flex items-center gap-1.5 rounded-sm bg-layer-1 px-3 py-2 text-caption-sm-regular text-tertiary">
          <Info className="size-3.5 flex-shrink-0" />
          {t("cybernetics_data.item.disconnected")}
        </p>
      )}
      {records.map((record) => (
        <CyberneticsRecordItem
          key={record.id}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          record={record}
          canView={isMember && isActive}
          canRefresh={isMember && isActive && !disabled}
          canRemove={!disabled && (isAdmin || (isMember && record.created_by === currentUser?.id))}
        />
      ))}
    </div>
  );
});
