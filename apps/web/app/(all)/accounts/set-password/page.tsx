/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// components
import { ResetPasswordForm } from "@/components/account/auth-forms/reset-password";
import { AuthShell } from "@/components/auth-screens/auth-shell";
// helpers
import { EPageTypes } from "@/helpers/authentication.helper";
// layouts
import DefaultLayout from "@/layouts/default-layout";
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";

function SetPasswordPage() {
  return (
    <DefaultLayout>
      <AuthenticationWrapper pageType={EPageTypes.SET_PASSWORD}>
        <AuthShell>
          <ResetPasswordForm />
        </AuthShell>
      </AuthenticationWrapper>
    </DefaultLayout>
  );
}

export default SetPasswordPage;
