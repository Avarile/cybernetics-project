/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Link } from "react-router";
import { AlertTriangle, Lock } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button, getButtonStyling } from "@plane/propel/button";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { getCyberneticsErrorKey, getCyberneticsErrorI18nKey } from "../helpers";

type Props = {
  error: unknown;
  workspaceSlug: string;
  projectId: string;
  onRetry?: () => void;
};

export const CyberneticsErrorBanner = observer(function CyberneticsErrorBanner(props: Props) {
  const { error, workspaceSlug, projectId, onRetry } = props;
  // translation
  const { t } = useTranslation();
  // store hooks
  const { allowPermissions } = useUserPermissions();
  // derived values
  const errorKey = getCyberneticsErrorKey(error);
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);
  const showSettingsLink =
    isAdmin &&
    (errorKey === "CYBERNETICS_UNAUTHORIZED" ||
      errorKey === "CYBERNETICS_TOKEN_UNREADABLE" ||
      errorKey === "CYBERNETICS_NOT_CONFIGURED");
  const showRetry =
    !!onRetry &&
    (errorKey === undefined || errorKey === "CYBERNETICS_UNREACHABLE" || errorKey === "CYBERNETICS_RATE_LIMITED");
  const Icon = errorKey === "CYBERNETICS_FORBIDDEN" ? Lock : AlertTriangle;

  return (
    <div className="flex flex-col items-start gap-2 rounded-md bg-danger-subtle px-3 py-2 text-caption-sm-regular text-danger-primary sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-start gap-1.5">
        <Icon className="mt-0.5 size-3.5 flex-shrink-0" />
        {t(getCyberneticsErrorI18nKey(error))}
      </span>
      <div className="flex flex-shrink-0 items-center gap-2">
        {showSettingsLink && (
          <Link
            to={`/${workspaceSlug}/settings/projects/${projectId}/cybernetics-data`}
            className={getButtonStyling("secondary", "sm")}
          >
            {t("cybernetics_data.errors.open_settings")}
          </Link>
        )}
        {showRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t("cybernetics_data.browser.retry")}
          </Button>
        )}
      </div>
    </div>
  );
});
