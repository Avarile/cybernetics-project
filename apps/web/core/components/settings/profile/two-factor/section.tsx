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
import { maskEmail, renderFormattedDate } from "@plane/utils";
// components
import { ProfileSettingsHeading } from "@/components/settings/profile/heading";
// hooks
import { useInstance } from "@/hooks/store/use-instance";
import { useUser } from "@/hooks/store/user";
// local imports
import { TwoFactorEmailModal } from "./modal";

export const TwoFactorEmailSection = observer(function TwoFactorEmailSection() {
  // states
  const [isModalOpen, setIsModalOpen] = useState(false);
  // store
  const { data: currentUser } = useUser();
  const { config } = useInstance();
  // i18n
  const { t } = useTranslation();

  if (!currentUser) return null;

  const enabled = Boolean(currentUser.is_two_factor_email_enabled);
  const hasPassword = !currentUser.is_password_autoset;
  const isSMTPConfigured = config?.is_smtp_configured ?? false;
  // turning it off is always offered, so nobody is stuck with it on
  const canChange = enabled || (hasPassword && isSMTPConfigured);

  let description = t("auth.two_factor.settings.description_off", { email: maskEmail(currentUser.email) });
  if (enabled) {
    description = t("auth.two_factor.settings.description_on", {
      date: renderFormattedDate(currentUser.two_factor_enabled_at ?? undefined) ?? "",
    });
  } else if (!hasPassword) {
    description = t("auth.two_factor.settings.password_required");
  } else if (!isSMTPConfigured) {
    description = t("auth.two_factor.settings.smtp_not_configured");
  }

  return (
    <div className="mt-10">
      <ProfileSettingsHeading title={t("auth.two_factor.settings.heading")} />
      <div className="mt-7 flex items-center justify-between gap-4 rounded-md border border-subtle px-4 py-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h4 className="text-13 font-medium text-primary">{t("auth.two_factor.settings.title")}</h4>
            <span
              className={
                enabled
                  ? "rounded-sm bg-success-subtle px-1.5 text-11 font-medium text-success-primary"
                  : "rounded-sm bg-layer-3 px-1.5 text-11 font-medium text-tertiary"
              }
            >
              {enabled ? t("auth.two_factor.settings.on") : t("auth.two_factor.settings.off")}
            </span>
          </div>
          <p className="text-12 text-tertiary">{description}</p>
        </div>
        <Button
          variant={enabled ? "error-outline" : "secondary"}
          size="lg"
          disabled={!canChange}
          onClick={() => setIsModalOpen(true)}
        >
          {enabled ? t("auth.two_factor.settings.disable") : t("auth.two_factor.settings.enable")}
        </Button>
      </div>
      <TwoFactorEmailModal
        // remount per open so each attempt starts from the password step
        key={isModalOpen ? "open" : "closed"}
        isOpen={isModalOpen}
        action={enabled ? "disable" : "enable"}
        email={currentUser.email}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
});
