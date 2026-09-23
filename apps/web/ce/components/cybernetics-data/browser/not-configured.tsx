/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EmptyStateCompact } from "@plane/propel/empty-state";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
// plane web imports
import { useCyberneticsData } from "@/plane-web/hooks/store/use-cybernetics-data";

type Props = {
  workspaceSlug: string;
  projectId: string;
};

export const CyberneticsBrowserNotConfigured = observer(function CyberneticsBrowserNotConfigured(props: Props) {
  const { workspaceSlug, projectId } = props;
  // router
  const router = useAppRouter();
  // translation
  const { t } = useTranslation();
  // store hooks
  const { allowPermissions } = useUserPermissions();
  const { closeBrowser } = useCyberneticsData();
  // derived values
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);

  return (
    <div className="flex min-h-[320px] items-center justify-center p-6">
      <EmptyStateCompact
        title={t("cybernetics_data.browser.not_configured.title")}
        description={
          isAdmin
            ? t("cybernetics_data.browser.not_configured.description")
            : t("cybernetics_data.browser.not_configured.description_member")
        }
        actions={
          isAdmin
            ? [
                {
                  label: t("cybernetics_data.browser.not_configured.cta"),
                  variant: "primary",
                  onClick: () => {
                    closeBrowser();
                    router.push(`/${workspaceSlug}/settings/projects/${projectId}/cybernetics-data`);
                  },
                },
              ]
            : undefined
        }
      />
    </div>
  );
});
