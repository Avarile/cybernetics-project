/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import type {
  TCyberneticsDatabaseGroup,
  TCyberneticsIntegration,
  TCyberneticsIntegrationPayload,
  TCyberneticsRecordDetail,
  TCyberneticsRecordsQuery,
  TCyberneticsRecordsResponse,
  TCyberneticsSchema,
  TCyberneticsTable,
  TCyberneticsTestPayload,
  TCyberneticsVerification,
  TIssueCyberneticsAttachResponse,
  TIssueCyberneticsRecord,
  TIssueCyberneticsRecordReference,
} from "@plane/types";
// services
import { APIService } from "@/services/api.service";

/**
 * Talks to the Plane API proxy for Cybernetics Data. The browser never calls Cybernetics Data directly.
 * Errors are re-thrown as the response body (`{ error, code }`) so callers can branch on `code`.
 */
export class CyberneticsDataService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private integrationUrl(workspaceSlug: string, projectId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/cybernetics-data`;
  }

  private issueRecordsUrl(workspaceSlug: string, projectId: string, issueId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/cybernetics-records`;
  }

  // integration
  async getIntegration(workspaceSlug: string, projectId: string): Promise<TCyberneticsIntegration> {
    return this.get(`${this.integrationUrl(workspaceSlug, projectId)}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async saveIntegration(
    workspaceSlug: string,
    projectId: string,
    data: Partial<TCyberneticsIntegrationPayload>
  ): Promise<TCyberneticsIntegration> {
    return this.put(`${this.integrationUrl(workspaceSlug, projectId)}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteIntegration(workspaceSlug: string, projectId: string): Promise<void> {
    return this.delete(`${this.integrationUrl(workspaceSlug, projectId)}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async testIntegration(
    workspaceSlug: string,
    projectId: string,
    data: TCyberneticsTestPayload = {}
  ): Promise<TCyberneticsVerification> {
    return this.post(`${this.integrationUrl(workspaceSlug, projectId)}/test/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // browse
  async listDatabases(workspaceSlug: string, projectId: string): Promise<TCyberneticsDatabaseGroup[]> {
    return this.get(`${this.integrationUrl(workspaceSlug, projectId)}/databases/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listTables(workspaceSlug: string, projectId: string, baseId: string): Promise<TCyberneticsTable[]> {
    return this.get(`${this.integrationUrl(workspaceSlug, projectId)}/bases/${baseId}/tables/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getSchema(
    workspaceSlug: string,
    projectId: string,
    tableId: string,
    params: { base_id: string; view_id?: string }
  ): Promise<TCyberneticsSchema> {
    return this.get(`${this.integrationUrl(workspaceSlug, projectId)}/tables/${tableId}/schema/`, { params })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listRecords(
    workspaceSlug: string,
    projectId: string,
    tableId: string,
    query: TCyberneticsRecordsQuery
  ): Promise<TCyberneticsRecordsResponse> {
    const { filter, order_by, ...rest } = query;
    const params: Record<string, string | number | boolean> = {};
    Object.entries(rest).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params[key] = value;
    });
    if (filter && filter.filterSet.length > 0) params.filter = JSON.stringify(filter);
    if (order_by && order_by.length > 0) params.order_by = JSON.stringify(order_by);
    return this.get(`${this.integrationUrl(workspaceSlug, projectId)}/tables/${tableId}/records/`, { params })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getRecord(
    workspaceSlug: string,
    projectId: string,
    tableId: string,
    recordId: string,
    params: { base_id: string; cell_format?: "json" | "text" }
  ): Promise<TCyberneticsRecordDetail> {
    return this.get(`${this.integrationUrl(workspaceSlug, projectId)}/tables/${tableId}/records/${recordId}/`, {
      params,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // work item records
  async listIssueRecords(
    workspaceSlug: string,
    projectId: string,
    issueId: string
  ): Promise<TIssueCyberneticsRecord[]> {
    return this.get(`${this.issueRecordsUrl(workspaceSlug, projectId, issueId)}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async attachIssueRecords(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    records: TIssueCyberneticsRecordReference[]
  ): Promise<TIssueCyberneticsAttachResponse> {
    return this.post(`${this.issueRecordsUrl(workspaceSlug, projectId, issueId)}/`, { records })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async removeIssueRecord(workspaceSlug: string, projectId: string, issueId: string, id: string): Promise<void> {
    return this.delete(`${this.issueRecordsUrl(workspaceSlug, projectId, issueId)}/${id}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async refreshIssueRecords(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    ids?: string[]
  ): Promise<TIssueCyberneticsRecord[]> {
    return this.post(`${this.issueRecordsUrl(workspaceSlug, projectId, issueId)}/refresh/`, ids ? { ids } : {})
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
