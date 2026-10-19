/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
// plane internal packages
import type { EAdminAuthErrorCodes, TAdminAuthErrorInfo } from "@plane/constants";
import { API_BASE_URL } from "@plane/constants";
import { Button } from "@plane/propel/button";
import { AuthService } from "@plane/services";
import { Input, Spinner } from "@plane/ui";
import { maskEmail } from "@plane/utils";
// local components
import { AuthBanner } from "./auth-banner";
import { authErrorHandler } from "./auth-helpers";

const authService = new AuthService();

// matches the API's TWO_FACTOR_RESEND_COOLDOWN default; the code was sent just before this step opened
const RESEND_SECONDS = 30;

type Props = {
  email: string | undefined;
  errorInfo: TAdminAuthErrorInfo | undefined;
  setErrorInfo: (value: TAdminAuthErrorInfo | undefined) => void;
};

/** Code step of an admin sign-in with two-factor authentication; the challenge lives in the admin session. */
export function InstanceTwoFactorForm(props: Props) {
  const { email, errorInfo, setErrorInfo } = props;
  // state
  const [code, setCode] = useState("");
  const [csrfToken, setCsrfToken] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (csrfToken === undefined)
      authService.requestCSRFToken().then((data) => data?.csrf_token && setCsrfToken(data.csrf_token));
  }, [csrfToken]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timeout = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timeout);
  }, [resendIn]);

  const resend = async () => {
    setIsResending(true);
    setNotice(undefined);
    try {
      await authService.resendAdminSignInTwoFactorCode();
      setCode("");
      setResendIn(RESEND_SECONDS);
      setNotice("We sent you a new code.");
    } catch (error) {
      const errorCode = (error as { error_code?: number | string } | undefined)?.error_code?.toString();
      if (errorCode) setErrorInfo(authErrorHandler(errorCode as EAdminAuthErrorCodes));
    } finally {
      setIsResending(false);
    }
  };

  const digits = code.replace(/\D/g, "");
  const isResendDisabled = isResending || isSubmitting || resendIn > 0;

  return (
    <form
      className="space-y-4"
      method="POST"
      action={`${API_BASE_URL}/api/instances/admins/sign-in/two-factor/`}
      onSubmit={() => setIsSubmitting(true)}
      onError={() => setIsSubmitting(false)}
    >
      {errorInfo && <AuthBanner bannerData={errorInfo} handleBannerData={(value) => setErrorInfo(value)} />}
      <input type="hidden" name="csrfmiddlewaretoken" value={csrfToken} />

      <div className="space-y-1 text-center">
        <p className="text-14 font-medium text-primary">Check your email</p>
        <p className="text-13 text-tertiary">
          We sent a 6-digit sign-in code to {email ? maskEmail(email) : "your email"}.
        </p>
      </div>

      <div className="w-full space-y-1">
        <label className="text-13 font-medium text-tertiary" htmlFor="code">
          Verification code <span className="text-danger-primary">*</span>
        </label>
        <Input
          className="tracking-widest w-full border border-subtle !bg-surface-1 placeholder:text-placeholder"
          id="code"
          name="code"
          inputSize="md"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          autoFocus
        />
        <div className="flex w-full items-center justify-between gap-2 pt-1 text-11">
          <span className="text-tertiary">{notice}</span>
          <button
            type="button"
            onClick={() => void resend()}
            className={isResendDisabled ? "text-placeholder" : "font-medium text-accent-secondary"}
            disabled={isResendDisabled}
          >
            {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
          </button>
        </div>
      </div>

      <div className="space-y-2 py-2">
        <Button type="submit" size="xl" className="w-full" disabled={digits.length !== 6 || isSubmitting || !csrfToken}>
          {isSubmitting ? <Spinner height="20px" width="20px" /> : "Verify"}
        </Button>
        <a href="./" className="block text-center text-13 text-tertiary underline">
          Use a different account
        </a>
      </div>
    </form>
  );
}
