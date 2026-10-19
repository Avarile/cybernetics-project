/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { API_BASE_URL } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Input, Spinner } from "@plane/ui";
import { maskEmail } from "@plane/utils";
// helpers
import type { EAuthenticationErrorCodes } from "@/helpers/authentication.helper";
import { authErrorHandler } from "@/helpers/authentication.helper";
// hooks
import useTimer from "@/hooks/use-timer";
// services
import { AuthService } from "@/services/auth.service";

const authService = new AuthService();

// matches the API's TWO_FACTOR_RESEND_COOLDOWN default
const RESEND_SECONDS = 30;

type TAuthTwoFactorCodeForm = {
  email: string;
  handleEmailClear: () => void;
  nextPath: string | undefined;
};

/**
 * Code step of a password sign-in with two-factor authentication. The password was already
 * accepted and a code emailed; the challenge lives in the session, so the form only sends the code.
 */
export function AuthTwoFactorCodeForm(props: TAuthTwoFactorCodeForm) {
  const { email, handleEmailClear, nextPath } = props;
  // states
  const [code, setCode] = useState("");
  const [csrfToken, setCsrfToken] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string>();
  // the code was sent just before this step opened
  const { timer: resendTimer, setTimer: setResendTimer } = useTimer(RESEND_SECONDS);
  // plane hooks
  const { t } = useTranslation();

  useEffect(() => {
    if (csrfToken === undefined)
      authService.requestCSRFToken().then((data) => data?.csrf_token && setCsrfToken(data.csrf_token));
  }, [csrfToken]);

  const resend = async () => {
    setIsResending(true);
    setResendMessage(undefined);
    try {
      await authService.resendSignInTwoFactorCode();
      setCode("");
      setResendTimer(RESEND_SECONDS);
      setResendMessage(t("auth.two_factor.sign_in.code_sent"));
    } catch (error) {
      const errorCode = (error as { error_code?: number | string } | undefined)?.error_code?.toString();
      const info = errorCode ? authErrorHandler(errorCode as EAuthenticationErrorCodes) : undefined;
      setResendMessage(typeof info?.message === "string" ? info.message : undefined);
    } finally {
      setIsResending(false);
    }
  };

  const digits = code.replace(/\D/g, "");
  const isResendDisabled = isResending || isSubmitting || resendTimer > 0;

  return (
    <form
      className="space-y-4"
      method="POST"
      action={`${API_BASE_URL}/auth/sign-in/two-factor/`}
      onSubmit={() => setIsSubmitting(true)}
      onError={() => setIsSubmitting(false)}
    >
      <input type="hidden" name="csrfmiddlewaretoken" value={csrfToken} />
      {nextPath && <input type="hidden" value={nextPath} name="next_path" />}

      <div className="flex flex-col items-center gap-1 text-center">
        <MailCheck className="size-6 text-accent-primary" />
        <p className="text-14 font-medium text-primary">{t("auth.two_factor.sign_in.header")}</p>
        <p className="text-13 text-tertiary">{t("auth.two_factor.sign_in.sub_header", { email: maskEmail(email) })}</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="two-factor-code" className="text-13 font-medium text-tertiary">
          {t("auth.common.unique_code.label")}
        </label>
        <Input
          name="code"
          id="two-factor-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("auth.common.unique_code.placeholder")}
          className="tracking-widest h-10 w-full border border-strong !bg-surface-1 disable-autofill-style placeholder:text-placeholder"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          autoFocus
        />
        <div className="flex w-full items-center justify-between gap-2 px-1 pt-1 text-11">
          <span className="text-tertiary">{resendMessage}</span>
          <button
            type="button"
            onClick={() => void resend()}
            className={isResendDisabled ? "text-placeholder" : "font-medium text-accent-secondary"}
            disabled={isResendDisabled}
          >
            {resendTimer > 0 ? t("auth.common.resend_in", { seconds: resendTimer }) : t("common.resend")}
          </button>
        </div>
      </div>

      <div className="space-y-2.5">
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          size="xl"
          disabled={digits.length !== 6 || isSubmitting || !csrfToken}
        >
          {isSubmitting ? <Spinner height="20px" width="20px" /> : t("auth.two_factor.sign_in.verify")}
        </Button>
        <Button type="button" variant="link" className="w-full" size="xl" onClick={handleEmailClear}>
          {t("auth.two_factor.sign_in.use_different_account")}
        </Button>
      </div>
    </form>
  );
}
