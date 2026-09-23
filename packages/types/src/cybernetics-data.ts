/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// integration (project settings)
export type TCyberneticsVerificationStatus = "ok" | "unauthorized" | "forbidden" | "unreachable" | "error";

// guests only receive `is_configured` and `is_enabled`; everything else is admin/member only
export type TCyberneticsIntegration = {
  id?: string;
  project?: string;
  is_configured: boolean;
  is_enabled?: boolean;
  base_url?: string;
  token_hint?: string;
  last_verified_at?: string | null;
  last_verified_status?: TCyberneticsVerificationStatus | "";
  last_verified_message?: string;
  updated_at?: string;
  updated_by?: string;
};

export type TCyberneticsIntegrationPayload = {
  base_url: string;
  api_token?: string;
  is_enabled?: boolean;
  skip_verification?: boolean;
};

export type TCyberneticsTestPayload = {
  base_url?: string;
  api_token?: string;
};

export type TCyberneticsVerification = {
  status: TCyberneticsVerificationStatus;
  message: string;
  bases_visible?: number;
};

// error envelope returned by the Plane API for this integration:
// `{ error: <message>, error_code: <int>, error_message: <key> }`
export type TCyberneticsErrorKey =
  | "CYBERNETICS_NOT_CONFIGURED"
  | "CYBERNETICS_TOKEN_UNREADABLE"
  | "CYBERNETICS_TOKEN_REQUIRED"
  | "CYBERNETICS_UNAUTHORIZED"
  | "CYBERNETICS_FORBIDDEN"
  | "CYBERNETICS_NOT_FOUND"
  | "CYBERNETICS_BAD_REQUEST"
  | "CYBERNETICS_RATE_LIMITED"
  | "CYBERNETICS_UNREACHABLE"
  | "CYBERNETICS_VERIFICATION_FAILED"
  | "CYBERNETICS_ATTACH_FAILED"
  | "CYBERNETICS_ERROR";

export type TCyberneticsError = {
  error?: string;
  error_code?: number;
  error_message?: TCyberneticsErrorKey;
  verification?: TCyberneticsVerification;
  failed?: { record_id: string; table_id: string; error_message: TCyberneticsErrorKey }[];
  // field-level serializer errors
  base_url?: string | string[];
};

// browse
export type TCyberneticsFieldType =
  | "singleLineText"
  | "longText"
  | "user"
  | "attachment"
  | "checkbox"
  | "multipleSelect"
  | "singleSelect"
  | "date"
  | "number"
  | "rating"
  | "formula"
  | "rollup"
  | "conditionalRollup"
  | "link"
  | "createdTime"
  | "lastModifiedTime"
  | "createdBy"
  | "lastModifiedBy"
  | "autoNumber"
  | "button";

export type TCyberneticsCellValueType = "string" | "number" | "boolean" | "dateTime";

export type TCyberneticsDatabaseGroup = {
  space: { id: string; name: string };
  bases: { id: string; name: string; icon?: string | null }[];
};

export type TCyberneticsTable = {
  id: string;
  name: string;
  icon?: string | null;
  description?: string;
  default_view_id?: string;
};

export type TCyberneticsField = {
  id: string;
  name: string;
  type: TCyberneticsFieldType;
  is_primary: boolean;
  cell_value_type: TCyberneticsCellValueType;
  is_multiple: boolean;
  is_lookup?: boolean;
  options_lite?: Record<string, unknown>;
};

export type TCyberneticsView = { id: string; name: string; type: string };

export type TCyberneticsSchema = {
  fields: TCyberneticsField[];
  views: TCyberneticsView[];
};

export type TCyberneticsRecord = {
  id: string;
  name?: string;
  fields: Record<string, unknown>;
  created_time?: string;
  last_modified_time?: string;
  auto_number?: number;
};

export type TCyberneticsFilterOperator =
  | "is"
  | "isNot"
  | "contains"
  | "doesNotContain"
  | "isEmpty"
  | "isNotEmpty"
  | "isGreater"
  | "isLess"
  | "isBefore"
  | "isAfter";

export type TCyberneticsFilterCondition = {
  fieldId: string;
  operator: TCyberneticsFilterOperator;
  value: unknown;
};

export type TCyberneticsFilter = {
  conjunction: "and" | "or";
  filterSet: (TCyberneticsFilterCondition | TCyberneticsFilter)[];
};

export type TCyberneticsOrder = { field_id: string; order: "asc" | "desc" };

export type TCyberneticsRecordsQuery = {
  base_id: string;
  take?: number;
  skip?: number;
  view_id?: string;
  search?: string;
  search_field?: string;
  filter?: TCyberneticsFilter;
  order_by?: TCyberneticsOrder[];
  with_total?: boolean;
};

export type TCyberneticsRecordsResponse = {
  records: TCyberneticsRecord[];
  total?: number;
  take: number;
  skip: number;
};

export type TCyberneticsRecordDetail = {
  record: TCyberneticsRecord;
  fields: TCyberneticsField[];
  deep_link: string;
};

// work item attachments
export type TIssueCyberneticsRecordStatus = "ok" | "missing" | "forbidden";

export type TIssueCyberneticsRecord = {
  id: string;
  issue_id: string;
  base_id: string;
  base_name: string;
  table_id: string;
  table_name: string;
  record_id: string;
  record_name: string;
  view_id?: string | null;
  preview: Record<string, string>;
  source_url?: string;
  deep_link: string;
  snapshot_at: string | null;
  status: TIssueCyberneticsRecordStatus;
  created_by: string;
  created_at: string;
};

export type TIssueCyberneticsRecordReference = {
  base_id: string;
  table_id: string;
  record_id: string;
  view_id?: string;
};

export type TIssueCyberneticsAttachResponse = {
  created: TIssueCyberneticsRecord[];
  skipped: { table_id: string; record_id: string; reason: string }[];
};
