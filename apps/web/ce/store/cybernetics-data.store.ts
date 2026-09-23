/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { set, unset } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type {
  TCyberneticsIntegration,
  TCyberneticsIntegrationPayload,
  TCyberneticsTestPayload,
  TCyberneticsVerification,
  TIssueCyberneticsAttachResponse,
  TIssueCyberneticsRecord,
  TIssueCyberneticsRecordReference,
} from "@plane/types";
// services
import { CyberneticsDataService } from "@/plane-web/services/cybernetics-data.service";
// store
import type { RootStore } from "@/plane-web/store/root.store";

export type TCyberneticsBrowserTarget = { baseId: string; tableId: string; recordId: string };

export type TCyberneticsBrowserModal = {
  isOpen: boolean;
  issueId: string | null;
  mode: "browse" | "view";
  target?: TCyberneticsBrowserTarget;
};

export interface ICyberneticsDataStore {
  // observables
  integrationMap: Record<string, TCyberneticsIntegration>; // projectId => integration
  issueRecordIds: Record<string, string[]>; // issueId => record link ids
  recordMap: Record<string, TIssueCyberneticsRecord>; // record link id => record link
  browserModal: TCyberneticsBrowserModal;
  // helpers
  getIntegration: (projectId: string) => TCyberneticsIntegration | undefined;
  isIntegrationActive: (projectId: string) => boolean;
  getRecordsByIssueId: (issueId: string) => TIssueCyberneticsRecord[];
  getRecordCountByIssueId: (issueId: string) => number;
  // integration actions
  fetchIntegration: (workspaceSlug: string, projectId: string) => Promise<TCyberneticsIntegration>;
  saveIntegration: (
    workspaceSlug: string,
    projectId: string,
    data: Partial<TCyberneticsIntegrationPayload>
  ) => Promise<TCyberneticsIntegration>;
  deleteIntegration: (workspaceSlug: string, projectId: string) => Promise<void>;
  testIntegration: (
    workspaceSlug: string,
    projectId: string,
    data?: TCyberneticsTestPayload
  ) => Promise<TCyberneticsVerification>;
  // work item record actions
  fetchIssueRecords: (workspaceSlug: string, projectId: string, issueId: string) => Promise<TIssueCyberneticsRecord[]>;
  attachIssueRecords: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    records: TIssueCyberneticsRecordReference[]
  ) => Promise<TIssueCyberneticsAttachResponse>;
  removeIssueRecord: (workspaceSlug: string, projectId: string, issueId: string, id: string) => Promise<void>;
  refreshIssueRecords: (workspaceSlug: string, projectId: string, issueId: string, ids?: string[]) => Promise<void>;
  // modal actions
  openBrowser: (issueId: string, mode?: "browse" | "view", target?: TCyberneticsBrowserTarget) => void;
  closeBrowser: () => void;
}

export class CyberneticsDataStore implements ICyberneticsDataStore {
  // observables
  integrationMap: Record<string, TCyberneticsIntegration> = {};
  issueRecordIds: Record<string, string[]> = {};
  recordMap: Record<string, TIssueCyberneticsRecord> = {};
  browserModal: TCyberneticsBrowserModal = { isOpen: false, issueId: null, mode: "browse" };
  // root store
  rootStore: RootStore;
  // services
  cyberneticsDataService: CyberneticsDataService;

  constructor(rootStore: RootStore) {
    makeObservable(this, {
      // observables
      integrationMap: observable,
      issueRecordIds: observable,
      recordMap: observable,
      browserModal: observable.ref,
      // actions
      fetchIntegration: action,
      saveIntegration: action,
      deleteIntegration: action,
      fetchIssueRecords: action,
      attachIssueRecords: action,
      removeIssueRecord: action,
      refreshIssueRecords: action,
      openBrowser: action,
      closeBrowser: action,
    });
    this.rootStore = rootStore;
    this.cyberneticsDataService = new CyberneticsDataService();
  }

  // helpers
  getIntegration = computedFn((projectId: string) => this.integrationMap[projectId]);

  isIntegrationActive = computedFn((projectId: string) => {
    const integration = this.integrationMap[projectId];
    return !!integration?.is_configured && !!integration?.is_enabled;
  });

  getRecordsByIssueId = computedFn((issueId: string) =>
    (this.issueRecordIds[issueId] ?? [])
      .map((id) => this.recordMap[id])
      .filter((record): record is TIssueCyberneticsRecord => !!record)
  );

  getRecordCountByIssueId = computedFn((issueId: string) => this.issueRecordIds[issueId]?.length ?? 0);

  // private helpers
  private addRecords = (issueId: string, records: TIssueCyberneticsRecord[], replace: boolean) => {
    runInAction(() => {
      const existingIds = replace ? [] : (this.issueRecordIds[issueId] ?? []);
      const newIds = records.map((record) => record.id).filter((id) => !existingIds.includes(id));
      records.forEach((record) => set(this.recordMap, [record.id], record));
      set(this.issueRecordIds, [issueId], [...existingIds, ...newIds]);
    });
  };

  private refreshActivity = (workspaceSlug: string, projectId: string, issueId: string) => {
    const issueDetail = this.rootStore.issue.issueDetail;
    void issueDetail.activity.fetchActivities(workspaceSlug, projectId, issueId);
    issueDetail.setLastWidgetAction("cybernetics-records");
  };

  // integration actions
  fetchIntegration = async (workspaceSlug: string, projectId: string) => {
    const response = await this.cyberneticsDataService.getIntegration(workspaceSlug, projectId);
    runInAction(() => {
      set(this.integrationMap, [projectId], response);
    });
    return response;
  };

  saveIntegration = async (workspaceSlug: string, projectId: string, data: Partial<TCyberneticsIntegrationPayload>) => {
    const response = await this.cyberneticsDataService.saveIntegration(workspaceSlug, projectId, data);
    runInAction(() => {
      set(this.integrationMap, [projectId], response);
    });
    return response;
  };

  deleteIntegration = async (workspaceSlug: string, projectId: string) => {
    await this.cyberneticsDataService.deleteIntegration(workspaceSlug, projectId);
    runInAction(() => {
      set(this.integrationMap, [projectId], { is_configured: false });
    });
  };

  testIntegration = async (workspaceSlug: string, projectId: string, data?: TCyberneticsTestPayload) =>
    this.cyberneticsDataService.testIntegration(workspaceSlug, projectId, data);

  // work item record actions
  fetchIssueRecords = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const response = await this.cyberneticsDataService.listIssueRecords(workspaceSlug, projectId, issueId);
    this.addRecords(issueId, response ?? [], true);
    return response;
  };

  attachIssueRecords = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    records: TIssueCyberneticsRecordReference[]
  ) => {
    const response = await this.cyberneticsDataService.attachIssueRecords(workspaceSlug, projectId, issueId, records);
    this.addRecords(issueId, response?.created ?? [], false);
    if (response?.created?.length) this.refreshActivity(workspaceSlug, projectId, issueId);
    return response;
  };

  removeIssueRecord = async (workspaceSlug: string, projectId: string, issueId: string, id: string) => {
    await this.cyberneticsDataService.removeIssueRecord(workspaceSlug, projectId, issueId, id);
    runInAction(() => {
      set(
        this.issueRecordIds,
        [issueId],
        (this.issueRecordIds[issueId] ?? []).filter((recordId) => recordId !== id)
      );
      unset(this.recordMap, [id]);
    });
    void this.rootStore.issue.issueDetail.activity.fetchActivities(workspaceSlug, projectId, issueId);
  };

  refreshIssueRecords = async (workspaceSlug: string, projectId: string, issueId: string, ids?: string[]) => {
    await this.cyberneticsDataService.refreshIssueRecords(workspaceSlug, projectId, issueId, ids);
    await this.fetchIssueRecords(workspaceSlug, projectId, issueId);
  };

  // modal actions
  openBrowser = (issueId: string, mode: "browse" | "view" = "browse", target?: TCyberneticsBrowserTarget) => {
    this.browserModal = { isOpen: true, issueId, mode, target };
    // lets the work item detail suppress keyboard shortcuts and peek close while the modal is open
    this.rootStore.issue.issueDetail.setAdditionalWidgetModalOpen(true);
  };

  closeBrowser = () => {
    this.browserModal = { isOpen: false, issueId: null, mode: "browse" };
    this.rootStore.issue.issueDetail.setAdditionalWidgetModalOpen(false);
  };
}
