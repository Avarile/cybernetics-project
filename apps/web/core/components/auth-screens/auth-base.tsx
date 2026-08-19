/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { useTranslation } from "@plane/i18n";
import { AuthRoot } from "@/components/account/auth-forms/auth-root";
import { PageHead } from "@/components/core/page-title";
import { EAuthModes } from "@/helpers/authentication.helper";
import { AuthShell } from "./auth-shell";
import { AuthModeTabs } from "./mode-tabs";

const AUTH_PAGE_TITLE_KEYS = {
  [EAuthModes.SIGN_IN]: "auth.common.login",
  [EAuthModes.SIGN_UP]: "auth.common.create_account",
};

type AuthBaseProps = {
  authType: EAuthModes;
};

export function AuthBase({ authType }: AuthBaseProps) {
  // plane hooks
  const { t } = useTranslation();

  return (
    <AuthShell headerAction={<AuthModeTabs currentMode={authType} />}>
      <PageHead title={`${t(AUTH_PAGE_TITLE_KEYS[authType])} - Cybernetics`} />
      <AuthRoot authMode={authType} />
    </AuthShell>
  );
}
