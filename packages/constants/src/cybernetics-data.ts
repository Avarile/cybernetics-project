/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type { TCyberneticsErrorKey, TCyberneticsRecordsQuery } from "@plane/types";

export const CYBERNETICS_DATA_PAGE_SIZE = 50;
// the API rejects more records per attach or refresh request
export const CYBERNETICS_DATA_MAX_ATTACH = 10;
// number of non-primary fields shown as columns in the records table
export const CYBERNETICS_DATA_MAX_COLUMNS = 5;
export const CYBERNETICS_DATA_TOKEN_PREFIX = "cybernetics_";

// `error_message` key → `error_code` int, as returned by the API (plane/utils/error_codes.py)
export const CYBERNETICS_DATA_ERROR_CODES: Record<TCyberneticsErrorKey, number> = {
  CYBERNETICS_NOT_CONFIGURED: 4801,
  CYBERNETICS_TOKEN_UNREADABLE: 4802,
  CYBERNETICS_TOKEN_REQUIRED: 4803,
  CYBERNETICS_UNAUTHORIZED: 4804,
  CYBERNETICS_FORBIDDEN: 4805,
  CYBERNETICS_NOT_FOUND: 4806,
  CYBERNETICS_BAD_REQUEST: 4807,
  CYBERNETICS_RATE_LIMITED: 4808,
  CYBERNETICS_UNREACHABLE: 4809,
  CYBERNETICS_VERIFICATION_FAILED: 4810,
  CYBERNETICS_ATTACH_FAILED: 4811,
  CYBERNETICS_ERROR: 4812,
};

export const CYBERNETICS_DATA_ERROR_I18N_KEYS: Record<TCyberneticsErrorKey, string> = {
  CYBERNETICS_NOT_CONFIGURED: "cybernetics_data.errors.not_configured",
  CYBERNETICS_TOKEN_UNREADABLE: "cybernetics_data.errors.unreadable_token",
  CYBERNETICS_UNAUTHORIZED: "cybernetics_data.errors.unauthorized",
  CYBERNETICS_FORBIDDEN: "cybernetics_data.errors.forbidden",
  CYBERNETICS_NOT_FOUND: "cybernetics_data.errors.not_found",
  CYBERNETICS_BAD_REQUEST: "cybernetics_data.errors.bad_request",
  CYBERNETICS_RATE_LIMITED: "cybernetics_data.errors.rate_limited",
  CYBERNETICS_UNREACHABLE: "cybernetics_data.errors.unreachable",
  CYBERNETICS_ATTACH_FAILED: "cybernetics_data.errors.attach_failed",
  CYBERNETICS_ERROR: "cybernetics_data.errors.generic",
  CYBERNETICS_VERIFICATION_FAILED: "project_settings.cybernetics_data.toast.test_failed",
  CYBERNETICS_TOKEN_REQUIRED: "project_settings.cybernetics_data.token_required_url_change",
};

export const CYBERNETICS_DATA_GENERIC_ERROR_I18N_KEY = "cybernetics_data.errors.generic";

// SWR keys
export const CYBERNETICS_INTEGRATION_KEY = (projectId: string) => `CYBERNETICS_INTEGRATION_${projectId}`;
export const CYBERNETICS_DATABASES_KEY = (projectId: string) => `CYBERNETICS_DATABASES_${projectId}`;
export const CYBERNETICS_TABLES_KEY = (projectId: string, baseId: string) =>
  `CYBERNETICS_TABLES_${projectId}_${baseId}`;
export const CYBERNETICS_SCHEMA_KEY = (projectId: string, baseId: string, tableId: string) =>
  `CYBERNETICS_SCHEMA_${projectId}_${baseId}_${tableId}`;
export const CYBERNETICS_RECORDS_KEY = (projectId: string, tableId: string, query: TCyberneticsRecordsQuery) =>
  `CYBERNETICS_RECORDS_${projectId}_${tableId}_${JSON.stringify(query)}`;
export const CYBERNETICS_RECORD_KEY = (projectId: string, baseId: string, tableId: string, recordId: string) =>
  `CYBERNETICS_RECORD_${projectId}_${baseId}_${tableId}_${recordId}`;
export const ISSUE_CYBERNETICS_RECORDS_KEY = (issueId: string) => `ISSUE_CYBERNETICS_RECORDS_${issueId}`;
