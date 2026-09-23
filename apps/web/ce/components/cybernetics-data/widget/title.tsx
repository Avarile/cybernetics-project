/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useMemo } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CollapsibleButton } from "@plane/ui";
// plane web imports
import { useCyberneticsData } from "@/plane-web/hooks/store/use-cybernetics-data";
// local imports
import { CyberneticsDataActionButton } from "./action-button";

type Props = {
  isOpen: boolean;
  projectId: string;
  issueId: string;
  disabled: boolean;
};

export const CyberneticsRecordsCollapsibleTitle = observer(function CyberneticsRecordsCollapsibleTitle(props: Props) {
  const { isOpen, projectId, issueId, disabled } = props;
  // translation
  const { t } = useTranslation();
  // store hooks
  const { getRecordCountByIssueId, isIntegrationActive } = useCyberneticsData();
  // derived values
  const recordsCount = getRecordCountByIssueId(issueId);
  const canAttach = !disabled && isIntegrationActive(projectId);

  // indicator element
  const indicatorElement = useMemo(
    () => (
      <span className="flex items-center justify-center">
        <p className="text-14 !leading-3 text-tertiary">{recordsCount}</p>
      </span>
    ),
    [recordsCount]
  );

  return (
    <CollapsibleButton
      isOpen={isOpen}
      title={t("cybernetics_data.widget.title")}
      indicatorElement={indicatorElement}
      actionItemElement={canAttach && <CyberneticsDataActionButton workItemId={issueId} disabled={disabled} />}
    />
  );
});
