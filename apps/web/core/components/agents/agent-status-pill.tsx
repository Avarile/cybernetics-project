/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { AGENT_STATUS_DETAILS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TAgentStatus } from "@plane/types";
import { cn } from "@plane/utils";

export function AgentStatusPill({ status }: { status: TAgentStatus }) {
  const { t } = useTranslation();
  const details = AGENT_STATUS_DETAILS[status];
  return (
    <span className={cn("rounded-sm px-1.5 py-0.5 text-11 font-medium", details.className)}>
      {t(details.i18n_label)}
    </span>
  );
}
