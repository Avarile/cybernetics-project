/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane web imports
import { CyberneticsRecordActivity } from "@/plane-web/components/cybernetics-data/activity/record-activity";

export type TAdditionalActivityRoot = {
  activityId: string;
  showIssue?: boolean;
  ends: "top" | "bottom" | undefined;
  field: string | undefined;
};

export const AdditionalActivityRoot = observer(function AdditionalActivityRoot(props: TAdditionalActivityRoot) {
  const { activityId, ends, field } = props;

  if (field === "cybernetics_record") return <CyberneticsRecordActivity activityId={activityId} ends={ends} />;
  return <></>;
});
