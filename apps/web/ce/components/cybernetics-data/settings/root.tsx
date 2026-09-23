/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { CYBERNETICS_INTEGRATION_KEY } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Loader, ToggleSwitch } from "@plane/ui";
// components
import { SettingsBoxedControlItem } from "@/components/settings/boxed-control-item";
import { SettingsHeading } from "@/components/settings/heading";
// plane web imports
import { useCyberneticsData } from "@/plane-web/hooks/store/use-cybernetics-data";
// local imports
import { getCyberneticsErrorI18nKey } from "../helpers";
import { CyberneticsDataDangerZone } from "./danger-zone";
import { CyberneticsDataSettingsForm } from "./form";
import { CyberneticsStatusBadge } from "./status-badge";

type Props = {
  workspaceSlug: string;
  projectId: string;
};

export const CyberneticsDataSettingsRoot = observer(function CyberneticsDataSettingsRoot(props: Props) {
  const { workspaceSlug, projectId } = props;
  // states
  const [isToggling, setIsToggling] = useState(false);
  // translation
  const { t } = useTranslation();
  // store hooks
  const { getIntegration, fetchIntegration, saveIntegration } = useCyberneticsData();
  // fetch
  const { isLoading } = useSWR(
    workspaceSlug && projectId ? CYBERNETICS_INTEGRATION_KEY(projectId) : null,
    workspaceSlug && projectId ? () => fetchIntegration(workspaceSlug, projectId) : null,
    { revalidateOnFocus: false }
  );
  // derived values
  const integration = getIntegration(projectId);
  const isConfigured = !!integration?.is_configured;
  const isEnabled = !!integration?.is_enabled;
  const badgeStatus = !isConfigured
    ? "not_configured"
    : !isEnabled
      ? "disabled"
      : integration?.last_verified_status || "never";

  const handleToggle = async (value: boolean) => {
    if (!integration?.is_configured) return;
    setIsToggling(true);
    try {
      // only the flag is sent so the stored URL isn't re-validated
      await saveIntegration(workspaceSlug, projectId, { is_enabled: value });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: value
          ? t("project_settings.cybernetics_data.toast.enabled")
          : t("project_settings.cybernetics_data.toast.disabled"),
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_settings.cybernetics_data.toast.error"),
        message: t(getCyberneticsErrorI18nKey(error)),
      });
    } finally {
      setIsToggling(false);
    }
  };

  if (!integration && isLoading) {
    return (
      <Loader className="flex w-full flex-col gap-4">
        <Loader.Item height="40px" />
        <Loader.Item height="72px" />
        <Loader.Item height="72px" />
      </Loader>
    );
  }

  return (
    <section className="flex w-full flex-col gap-6">
      <SettingsHeading
        title={t("project_settings.cybernetics_data.heading")}
        description={t("project_settings.cybernetics_data.description")}
      />
      <CyberneticsStatusBadge
        status={badgeStatus}
        message={isConfigured && isEnabled ? integration?.last_verified_message : undefined}
        verifiedAt={isConfigured ? integration?.last_verified_at : undefined}
      />
      {isConfigured && (
        <SettingsBoxedControlItem
          title={t("project_settings.cybernetics_data.enabled_label")}
          description={t("project_settings.cybernetics_data.enabled_description")}
          control={
            <ToggleSwitch
              value={isEnabled}
              onChange={handleToggle}
              disabled={isToggling}
              label={t("project_settings.cybernetics_data.enabled_label")}
              size="sm"
            />
          }
        />
      )}
      <CyberneticsDataSettingsForm
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        integration={integration ?? { is_configured: false }}
      />
      {isConfigured && <CyberneticsDataDangerZone workspaceSlug={workspaceSlug} projectId={projectId} />}
    </section>
  );
});
