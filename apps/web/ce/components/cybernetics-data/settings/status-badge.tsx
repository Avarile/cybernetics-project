/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TCyberneticsVerificationStatus } from "@plane/types";
import { calculateTimeAgo, cn } from "@plane/utils";

type Props = {
  status: TCyberneticsVerificationStatus | "never" | "not_configured" | "disabled";
  message?: string;
  verifiedAt?: string | null;
  basesVisible?: number;
};

export function CyberneticsStatusBadge(props: Props) {
  const { status, message, verifiedAt, basesVisible } = props;
  // translation
  const { t } = useTranslation();
  // derived values
  const isOk = status === "ok";
  const isWarning = status === "forbidden";
  const isError = status === "unauthorized" || status === "unreachable" || status === "error";
  const Icon = isOk ? CheckCircle2 : isWarning ? AlertTriangle : isError ? XCircle : CircleDashed;
  const details =
    isOk && basesVisible !== undefined
      ? t("project_settings.cybernetics_data.bases_visible", { count: basesVisible })
      : message;

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn("inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-body-xs-medium", {
          "bg-success-subtle text-success-primary": isOk,
          "bg-warning-subtle text-warning-primary": isWarning,
          "bg-danger-subtle text-danger-primary": isError,
          "bg-layer-1 text-tertiary": !isOk && !isWarning && !isError,
        })}
      >
        <Icon className="size-3.5 flex-shrink-0" />
        <span>{t(`project_settings.cybernetics_data.status.${status}`)}</span>
        {verifiedAt && (
          <span className="font-normal opacity-80">
            · {t("project_settings.cybernetics_data.verified_ago", { time: calculateTimeAgo(verifiedAt) })}
          </span>
        )}
      </div>
      {details && <p className="text-caption-sm-regular break-words text-tertiary">{details}</p>}
    </div>
  );
}
