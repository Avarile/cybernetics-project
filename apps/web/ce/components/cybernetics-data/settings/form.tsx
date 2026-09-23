/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Controller, useForm } from "react-hook-form";
import { AlertTriangle, Info } from "lucide-react";
// plane imports
import { CYBERNETICS_DATA_TOKEN_PREFIX } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCyberneticsError, TCyberneticsIntegration, TCyberneticsVerification } from "@plane/types";
import { Input } from "@plane/ui";
// plane web imports
import { useCyberneticsData } from "@/plane-web/hooks/store/use-cybernetics-data";
// local imports
import {
  getCyberneticsErrorKey,
  getCyberneticsErrorI18nKey,
  getCyberneticsErrorMessage,
  isValidHttpUrl,
  normaliseCyberneticsBaseUrl,
} from "../helpers";
import { CyberneticsSecretInput } from "./secret-input";
import { CyberneticsStatusBadge } from "./status-badge";

type TFormValues = {
  base_url: string;
  api_token: string;
};

type Props = {
  workspaceSlug: string;
  projectId: string;
  integration: TCyberneticsIntegration;
};

export const CyberneticsDataSettingsForm = observer(function CyberneticsDataSettingsForm(props: Props) {
  const { workspaceSlug, projectId, integration } = props;
  // states
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TCyberneticsVerification | undefined>(undefined);
  const [saveError, setSaveError] = useState<{ message: string; canSkipVerification: boolean } | undefined>(undefined);
  // translation
  const { t } = useTranslation();
  // store hooks
  const { saveIntegration, testIntegration } = useCyberneticsData();
  // form
  const {
    control,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TFormValues>({
    defaultValues: { base_url: integration.base_url ?? "", api_token: "" },
  });
  // derived values
  const isConfigured = integration.is_configured;
  const tokenValue = watch("api_token");
  // the backend only reuses the stored token with the URL it was saved for (save and test)
  const isUrlChanged = isConfigured && normaliseCyberneticsBaseUrl(watch("base_url")) !== integration.base_url;
  const isStoredTokenUsable = isConfigured && !isUrlChanged;
  const showPrefixWarning = tokenValue.trim() !== "" && !tokenValue.trim().startsWith(CYBERNETICS_DATA_TOKEN_PREFIX);

  useEffect(() => {
    reset({ base_url: integration.base_url ?? "", api_token: "" });
  }, [integration.base_url, reset]);

  const buildPayload = (values: TFormValues) => {
    const token = values.api_token.trim();
    return {
      base_url: normaliseCyberneticsBaseUrl(values.base_url),
      ...(token ? { api_token: token } : {}),
    };
  };

  const handleTest = async (values: TFormValues) => {
    setIsTesting(true);
    setTestResult(undefined);
    try {
      const result = await testIntegration(workspaceSlug, projectId, buildPayload(values));
      setTestResult(result);
      setToast({
        type: result.status === "ok" ? TOAST_TYPE.SUCCESS : TOAST_TYPE.WARNING,
        title:
          result.status === "ok"
            ? t("project_settings.cybernetics_data.toast.test_ok")
            : t("project_settings.cybernetics_data.toast.test_failed"),
        message: result.message || undefined,
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_settings.cybernetics_data.toast.test_failed"),
        message: getCyberneticsErrorMessage(error) ?? t(getCyberneticsErrorI18nKey(error)),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (values: TFormValues, skipVerification = false) => {
    setSaveError(undefined);
    try {
      await saveIntegration(workspaceSlug, projectId, {
        ...buildPayload(values),
        ...(skipVerification ? { skip_verification: true } : {}),
      });
      setTestResult(undefined);
      reset({ base_url: normaliseCyberneticsBaseUrl(values.base_url), api_token: "" });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("project_settings.cybernetics_data.toast.saved"),
      });
    } catch (error) {
      const errorBody = (error ?? {}) as TCyberneticsError;
      if (errorBody.base_url) {
        const message = Array.isArray(errorBody.base_url) ? errorBody.base_url[0] : errorBody.base_url;
        setError("base_url", { type: "server", message });
        return;
      }
      if (errorBody.verification) setTestResult(errorBody.verification);
      setSaveError({
        message: getCyberneticsErrorMessage(error) ?? t(getCyberneticsErrorI18nKey(error)),
        // skipping verification only helps when the connection test itself failed
        canSkipVerification: getCyberneticsErrorKey(error) === "CYBERNETICS_VERIFICATION_FAILED",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit((values) => handleSave(values))} className="flex flex-col gap-6">
      {/* URL */}
      <div className="flex flex-col gap-1">
        <label htmlFor="cybernetics_base_url" className="text-13 text-secondary">
          {t("project_settings.cybernetics_data.url_label")}
        </label>
        <Controller
          control={control}
          name="base_url"
          rules={{
            required: t("project_settings.cybernetics_data.url_required"),
            validate: (value) =>
              isValidHttpUrl(normaliseCyberneticsBaseUrl(value)) || t("project_settings.cybernetics_data.url_invalid"),
          }}
          render={({ field: { value, onChange, ref } }) => (
            <Input
              id="cybernetics_base_url"
              name="base_url"
              type="url"
              value={value}
              onChange={onChange}
              ref={ref}
              hasError={!!errors.base_url}
              placeholder={t("project_settings.cybernetics_data.url_placeholder")}
              className="w-full rounded-md font-medium"
            />
          )}
        />
        {errors.base_url?.message ? (
          <p className="text-caption-sm-regular text-danger-primary">{errors.base_url.message}</p>
        ) : (
          <p className="text-caption-sm-regular text-tertiary">{t("project_settings.cybernetics_data.url_helper")}</p>
        )}
      </div>
      {/* Token */}
      <div className="flex flex-col gap-1">
        <label htmlFor="cybernetics_api_token" className="text-13 text-secondary">
          {t("project_settings.cybernetics_data.token_label")}
        </label>
        <Controller
          control={control}
          name="api_token"
          rules={{
            validate: (value, formValues) => {
              if (value.trim() !== "") return true;
              if (!isConfigured) return t("project_settings.cybernetics_data.token_required");
              return (
                normaliseCyberneticsBaseUrl(formValues.base_url) === integration.base_url ||
                t("project_settings.cybernetics_data.token_required_url_change")
              );
            },
          }}
          render={({ field: { value, onChange } }) => (
            <CyberneticsSecretInput
              id="cybernetics_api_token"
              name="api_token"
              value={value}
              onChange={onChange}
              hasError={!!errors.api_token}
              placeholder={
                isStoredTokenUsable
                  ? t("project_settings.cybernetics_data.token_placeholder_stored", {
                      hint: integration.token_hint ?? "",
                    })
                  : t("project_settings.cybernetics_data.token_placeholder_new")
              }
            />
          )}
        />
        {errors.api_token?.message ? (
          <p className="text-caption-sm-regular text-danger-primary">{errors.api_token.message}</p>
        ) : (
          isUrlChanged &&
          tokenValue.trim() === "" && (
            <p className="text-caption-sm-regular text-warning-primary">
              {t("project_settings.cybernetics_data.token_required_url_change")}
            </p>
          )
        )}
        <p className="text-caption-sm-regular text-tertiary">{t("project_settings.cybernetics_data.token_helper")}</p>
        {showPrefixWarning && (
          <p className="flex items-start gap-1.5 text-caption-sm-regular text-warning-primary">
            <AlertTriangle className="mt-0.5 size-3 flex-shrink-0" />
            {t("project_settings.cybernetics_data.token_prefix_warning")}
          </p>
        )}
        <p className="mt-1 flex items-start gap-1.5 rounded-md bg-layer-1 px-2 py-1.5 text-caption-sm-regular text-secondary">
          <Info className="mt-0.5 size-3 flex-shrink-0" />
          {t("project_settings.cybernetics_data.delegation_warning")}
        </p>
      </div>
      {/* Test result */}
      {testResult && (
        <CyberneticsStatusBadge
          status={testResult.status}
          message={testResult.message}
          basesVisible={testResult.bases_visible}
        />
      )}
      {/* Save error */}
      {saveError && (
        <div className="flex flex-col gap-2 rounded-md bg-danger-subtle px-3 py-2 text-caption-sm-regular text-danger-primary">
          <span>{saveError.message}</span>
          {saveError.canSkipVerification && (
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleSubmit((values) => handleSave(values, true))}
                loading={isSubmitting}
              >
                {t("project_settings.cybernetics_data.save_anyway")}
              </Button>
            </div>
          )}
        </div>
      )}
      {/* Actions */}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={handleSubmit(handleTest)}
          loading={isTesting}
          disabled={isSubmitting}
        >
          {isTesting
            ? t("project_settings.cybernetics_data.testing")
            : t("project_settings.cybernetics_data.test_button")}
        </Button>
        <Button type="submit" variant="primary" loading={isSubmitting} disabled={isTesting}>
          {isSubmitting
            ? t("project_settings.cybernetics_data.saving")
            : t("project_settings.cybernetics_data.save_button")}
        </Button>
      </div>
    </form>
  );
});
