/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { CYBERNETICS_DATA_ERROR_I18N_KEYS, CYBERNETICS_DATA_GENERIC_ERROR_I18N_KEY } from "@plane/constants";
import type { TCyberneticsError, TCyberneticsErrorKey } from "@plane/types";

/** Returns the `error_message` key (e.g. `CYBERNETICS_FORBIDDEN`) from an API error body, if any. */
export const getCyberneticsErrorKey = (error: unknown): TCyberneticsErrorKey | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const key = (error as TCyberneticsError).error_message;
  return typeof key === "string" && Object.hasOwn(CYBERNETICS_DATA_ERROR_I18N_KEYS, key) ? key : undefined;
};

/** Maps an API error body to an i18n key for display. */
export const getCyberneticsErrorI18nKey = (error: unknown): string => {
  const key = getCyberneticsErrorKey(error);
  return key ? CYBERNETICS_DATA_ERROR_I18N_KEYS[key] : CYBERNETICS_DATA_GENERIC_ERROR_I18N_KEY;
};

/** Returns the raw server message from an API error body, if any. */
export const getCyberneticsErrorMessage = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const message = (error as TCyberneticsError).error;
  return typeof message === "string" && message.trim() !== "" ? message : undefined;
};

/** Trims the value, removes trailing slashes and a trailing `/api` segment. The server normalises too. */
export const normaliseCyberneticsBaseUrl = (value: string): string =>
  value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "")
    .replace(/\/+$/, "");

export const isValidHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/** Only allow http(s) URLs coming from external data to be used as links or image sources. */
export const getSafeExternalUrl = (value: unknown): string | undefined =>
  typeof value === "string" && isValidHttpUrl(value) ? value : undefined;

/** Returns the local storage key used to remember the last browsed table of a project. */
export const getLastTableStorageKey = (projectId: string) => `cybernetics-data:last:${projectId}`;
