/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Eye, EyeOff } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
import { maskEmail } from "@plane/utils";
// helpers
import type { EAuthenticationErrorCodes } from "@/helpers/authentication.helper";
import { authErrorHandler } from "@/helpers/authentication.helper";
// hooks
import { useUser } from "@/hooks/store/user";
import useTimer from "@/hooks/use-timer";
// services
import type { TTwoFactorAction } from "@/services/auth.service";
import { AuthService } from "@/services/auth.service";

const authService = new AuthService();

const RESEND_SECONDS = 30;

type Props = {
  isOpen: boolean;
  action: TTwoFactorAction;
  email: string;
  onClose: () => void;
};

type TStep = "password" | "code";

export const TwoFactorEmailModal = observer(function TwoFactorEmailModal(props: Props) {
  const { isOpen, action, email, onClose } = props;
  // states
  const [step, setStep] = useState<TStep>("password");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [token, setToken] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  // hooks
  const { t } = useTranslation();
  const { fetchCurrentUser } = useUser();
  const { timer: resendTimer, setTimer: setResendTimer } = useTimer(0);

  const maskedEmail = maskEmail(email);
  const digits = code.replace(/\D/g, "");

  const showError = (err: unknown) => {
    const errorCode = (err as { error_code?: number | string } | undefined)?.error_code?.toString();
    const info = errorCode ? authErrorHandler(errorCode as EAuthenticationErrorCodes) : undefined;
    setError(
      typeof info?.message === "string" ? info.message : t("auth.common.password.toast.change_password.error.message")
    );
  };

  const getCsrfToken = async () => {
    const csrfToken = await authService.requestCSRFToken().then((data) => data?.csrf_token);
    if (!csrfToken) throw new Error("csrf token not found");
    return csrfToken;
  };

  const sendCode = async () => {
    setError(undefined);
    setIsSubmitting(true);
    try {
      const response = await authService.sendTwoFactorEmailCode(await getCsrfToken(), { action, password });
      setToken(response.token);
      setCode("");
      setStep("code");
      setResendTimer(RESEND_SECONDS);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("auth.two_factor.toast.code_sent") });
    } catch (err) {
      showError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirm = async () => {
    setError(undefined);
    setIsSubmitting(true);
    try {
      await authService.confirmTwoFactorEmail(await getCsrfToken(), action, { token, code: digits });
      await fetchCurrentUser();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: action === "enable" ? t("auth.two_factor.toast.enabled") : t("auth.two_factor.toast.disabled"),
      });
      onClose();
    } catch (err) {
      setCode("");
      showError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.LG}>
      <form
        className="flex flex-col gap-5 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (isSubmitting) return;
          if (step === "password") void sendCode();
          else if (digits.length === 6) void confirm();
        }}
      >
        <div className="flex flex-col gap-2">
          <h3 className="text-18 font-medium text-primary">
            {action === "enable" ? t("auth.two_factor.modal.enable_title") : t("auth.two_factor.modal.disable_title")}
          </h3>
          <p className="text-13 text-secondary">
            {step === "password"
              ? t("auth.two_factor.modal.password_description", { email: maskedEmail })
              : t("auth.two_factor.modal.code_description", { email: maskedEmail })}
          </p>
          {action === "disable" && step === "password" && (
            <p className="text-13 text-danger-primary">{t("auth.two_factor.modal.disable_warning")}</p>
          )}
        </div>

        {step === "password" ? (
          <div className="flex flex-col gap-y-2">
            <label htmlFor="two_factor_password" className="text-13">
              {t("auth.common.password.current_password.label")}
            </label>
            <div className="relative flex items-center rounded-md">
              <Input
                id="two_factor_password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full"
                autoComplete="current-password"
                autoFocus
              />
              {showPassword ? (
                <EyeOff
                  className="absolute right-3 h-5 w-5 stroke-placeholder hover:cursor-pointer"
                  onClick={() => setShowPassword(false)}
                />
              ) : (
                <Eye
                  className="absolute right-3 h-5 w-5 stroke-placeholder hover:cursor-pointer"
                  onClick={() => setShowPassword(true)}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-y-2">
            <label htmlFor="two_factor_code" className="text-13">
              {t("auth.two_factor.modal.code_label")}
            </label>
            <Input
              id="two_factor_code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="tracking-widest w-full"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              autoFocus
            />
            <div className="flex justify-end">
              <button
                type="button"
                className={
                  resendTimer > 0 || isSubmitting
                    ? "text-11 text-placeholder"
                    : "text-11 font-medium text-accent-secondary"
                }
                disabled={resendTimer > 0 || isSubmitting}
                onClick={() => void sendCode()}
              >
                {resendTimer > 0 ? t("auth.common.resend_in", { seconds: resendTimer }) : t("common.resend")}
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-13 text-danger-primary">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          {step === "code" ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => {
                setError(undefined);
                setStep("password");
              }}
            >
              {t("auth.two_factor.modal.back")}
            </Button>
          ) : (
            <Button type="button" variant="secondary" size="lg" onClick={onClose}>
              {t("cancel")}
            </Button>
          )}
          {step === "password" ? (
            <Button type="submit" variant="primary" size="lg" loading={isSubmitting} disabled={!password}>
              {isSubmitting ? t("auth.two_factor.modal.sending_code") : t("auth.two_factor.modal.send_code")}
            </Button>
          ) : (
            <Button
              type="submit"
              variant={action === "disable" ? "error-fill" : "primary"}
              size="lg"
              loading={isSubmitting}
              disabled={digits.length !== 6}
            >
              {t("auth.two_factor.modal.confirm")}
            </Button>
          )}
        </div>
      </form>
    </ModalCore>
  );
});
