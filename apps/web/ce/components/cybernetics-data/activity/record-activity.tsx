/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Database } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { IssueActivityBlockComponent } from "@/components/issues/issue-detail/issue-activity/activity/actions";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

type TCyberneticsRecordActivity = { activityId: string; ends: "top" | "bottom" | undefined };

export const CyberneticsRecordActivity = observer(function CyberneticsRecordActivity(
  props: TCyberneticsRecordActivity
) {
  const { activityId, ends } = props;
  // translation
  const { t } = useTranslation();
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  if (!activity) return <></>;
  const isCreated = activity.verb === "created";
  return (
    <IssueActivityBlockComponent
      icon={<Database size={14} className="text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        <span>{isCreated ? t("cybernetics_data.activity.attached") : t("cybernetics_data.activity.removed")} </span>
        <span className="font-medium break-all text-primary">
          {isCreated ? activity.new_value : activity.old_value}
        </span>
        .
      </>
    </IssueActivityBlockComponent>
  );
});
