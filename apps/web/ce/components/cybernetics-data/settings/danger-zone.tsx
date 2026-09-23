/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { AlertModalCore } from "@plane/ui";
// plane web imports
import { useCyberneticsData } from "@/plane-web/hooks/store/use-cybernetics-data";
// local imports
import { getCyberneticsErrorI18nKey } from "../helpers";

type Props = {
  workspaceSlug: string;
  projectId: string;
};

export const CyberneticsDataDangerZone = observer(function CyberneticsDataDangerZone(props: Props) {
  const { workspaceSlug, projectId } = props;
  // states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // translation
  const { t } = useTranslation();
  // store hooks
  const { deleteIntegration } = useCyberneticsData();

  const handleDisconnect = async () => {
    setIsDeleting(true);
    try {
      await deleteIntegration(workspaceSlug, projectId);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("project_settings.cybernetics_data.toast.disconnected"),
      });
      setIsModalOpen(false);
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_settings.cybernetics_data.toast.error"),
        message: t(getCyberneticsErrorI18nKey(error)),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-subtle pt-6">
      <AlertModalCore
        isOpen={isModalOpen}
        handleClose={() => setIsModalOpen(false)}
        handleSubmit={handleDisconnect}
        isSubmitting={isDeleting}
        title={t("project_settings.cybernetics_data.disconnect.title")}
        content={t("project_settings.cybernetics_data.disconnect.confirm")}
        primaryButtonText={{
          loading: t("project_settings.cybernetics_data.disconnect.loading"),
          default: t("project_settings.cybernetics_data.disconnect.button"),
        }}
      />
      <h4 className="text-h6-medium text-primary">{t("project_settings.cybernetics_data.disconnect.heading")}</h4>
      <div className="flex flex-col items-start justify-between gap-3 rounded-md border border-danger-strong px-4 py-3 md:flex-row md:items-center">
        <div className="flex flex-col gap-1">
          <p className="text-body-sm-medium text-primary">{t("project_settings.cybernetics_data.disconnect.title")}</p>
          <p className="text-caption-sm-regular text-tertiary">
            {t("project_settings.cybernetics_data.disconnect.description")}
          </p>
        </div>
        <Button variant="error-outline" onClick={() => setIsModalOpen(true)}>
          {t("project_settings.cybernetics_data.disconnect.button")}
        </Button>
      </div>
    </div>
  );
});
