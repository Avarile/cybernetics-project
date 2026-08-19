/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { AUTH_TRACKER_ELEMENTS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TabNavigationItem, TabNavigationList } from "@plane/propel/tab-navigation";
import { EAuthModes } from "@/helpers/authentication.helper";
import { useInstance } from "@/hooks/store/use-instance";

const AUTH_MODE_TABS: {
  mode: EAuthModes;
  labelKey: string;
  href: string;
  trackerElement?: string;
}[] = [
  {
    mode: EAuthModes.SIGN_IN,
    labelKey: "auth.common.login",
    href: "/",
    trackerElement: AUTH_TRACKER_ELEMENTS.SIGN_IN_FROM_SIGNUP,
  },
  {
    mode: EAuthModes.SIGN_UP,
    labelKey: "auth.common.sign_up",
    href: "/sign-up",
    trackerElement: AUTH_TRACKER_ELEMENTS.NAVIGATE_TO_SIGN_UP,
  },
];

type TAuthModeTabsProps = {
  currentMode: EAuthModes;
};

/**
 * Sign in / sign up switcher rendered in the top-right corner of the auth screen.
 * Hidden entirely when the instance has sign-ups disabled, since there is nothing to switch to.
 */
export const AuthModeTabs = observer(function AuthModeTabs({ currentMode }: TAuthModeTabsProps) {
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { config } = useInstance();
  // derived values
  const enableSignUpConfig = config?.enable_signup ?? false;

  if (!enableSignUpConfig) return null;

  return (
    <TabNavigationList className="rounded-lg bg-layer-3 p-0.5">
      {AUTH_MODE_TABS.map((tab) => (
        <Link key={tab.mode} href={tab.href} data-ph-element={tab.trackerElement}>
          <TabNavigationItem isActive={tab.mode === currentMode}>{t(tab.labelKey)}</TabNavigationItem>
        </Link>
      ))}
    </TabNavigationList>
  );
});
