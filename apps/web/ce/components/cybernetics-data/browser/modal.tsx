/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { X } from "lucide-react";
// plane imports
import {
  CYBERNETICS_DATA_MAX_ATTACH,
  CYBERNETICS_DATABASES_KEY,
  EUserPermissions,
  EUserPermissionsLevel,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCyberneticsError, TCyberneticsRecord } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// plane web imports
import { useCyberneticsData } from "@/plane-web/hooks/store/use-cybernetics-data";
import { CyberneticsDataService } from "@/plane-web/services/cybernetics-data.service";
// local imports
import { getCyberneticsErrorI18nKey, getLastTableStorageKey } from "../helpers";
import { CyberneticsRecordViewer } from "../viewer/record-viewer";
import type { TCyberneticsTableSelection } from "./database-tree";
import { CyberneticsDatabaseTree } from "./database-tree";
import { CyberneticsBrowserNotConfigured } from "./not-configured";
import { CyberneticsRecordsPane } from "./records-pane";
import type { TCyberneticsSelectedRecord } from "./selected-chips";
import { CyberneticsSelectedChips } from "./selected-chips";

const cyberneticsDataService = new CyberneticsDataService();

type TLocation = { spaceName?: string; baseId?: string; baseName?: string; tableId?: string; tableName?: string };

const readLastLocation = (projectId: string): TLocation => {
  try {
    const raw = window.localStorage.getItem(getLastTableStorageKey(projectId));
    const parsed = raw ? (JSON.parse(raw) as TLocation) : {};
    return typeof parsed?.baseId === "string" ? parsed : {};
  } catch {
    return {};
  }
};

const writeLastLocation = (projectId: string, location: TLocation) => {
  try {
    window.localStorage.setItem(getLastTableStorageKey(projectId), JSON.stringify(location));
  } catch {
    // storage may be unavailable (private mode); remembering the table is only a convenience
  }
};

const selectionKey = (tableId: string, recordId: string) => `${tableId}:${recordId}`;

type Props = {
  workspaceSlug: string;
  projectId: string;
  workItemId: string;
};

export const CyberneticsDataBrowserModal = observer(function CyberneticsDataBrowserModal(props: Props) {
  const { workspaceSlug, projectId, workItemId } = props;
  // translation
  const { t } = useTranslation();
  // store hooks
  const { browserModal, closeBrowser, isIntegrationActive, getRecordsByIssueId, attachIssueRecords } =
    useCyberneticsData();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { getProjectIdentifierById } = useProject();
  const { allowPermissions } = useUserPermissions();
  // states
  const [location, setLocation] = useState<TLocation>({});
  const [viewerRecordId, setViewerRecordId] = useState<string | undefined>(undefined);
  const [selection, setSelection] = useState<Record<string, TCyberneticsSelectedRecord>>({});
  const [failedRecordIds, setFailedRecordIds] = useState<string[]>([]);
  const [isAttaching, setIsAttaching] = useState(false);
  // derived values
  const isOpen = browserModal.isOpen && browserModal.issueId === workItemId;
  const isViewMode = browserModal.mode === "view" && !!browserModal.target;
  const isActive = isIntegrationActive(projectId);
  const issue = getIssueById(workItemId);
  const identifier = issue ? `${getProjectIdentifierById(projectId)}-${issue.sequence_id}` : "";
  const canAttach =
    !issue?.archived_at &&
    allowPermissions(
      [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
      EUserPermissionsLevel.PROJECT,
      workspaceSlug,
      projectId
    );
  const attachedRecords = getRecordsByIssueId(workItemId);
  const selectedRecords = Object.values(selection);
  const isSelectionFull = selectedRecords.length >= CYBERNETICS_DATA_MAX_ATTACH;
  // unselected records can't be ticked once the per-request cap is reached
  const isSelectionDisabled = (tableId: string, recordId: string) =>
    !canAttach || (isSelectionFull && !selection[selectionKey(tableId, recordId)]);

  // databases are loaded here too so the first base can be pre-selected
  const {
    data: databases,
    error: databasesError,
    isLoading: isDatabasesLoading,
    mutate: mutateDatabases,
  } = useSWR(
    isOpen && isActive && !isViewMode ? CYBERNETICS_DATABASES_KEY(projectId) : null,
    isOpen && isActive && !isViewMode ? () => cyberneticsDataService.listDatabases(workspaceSlug, projectId) : null,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  // restore the last browsed table, reset everything else when the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setLocation(readLastLocation(projectId));
    setViewerRecordId(undefined);
    setSelection({});
    setFailedRecordIds([]);
  }, [isOpen, projectId]);

  // pre-select the first base when nothing was remembered
  useEffect(() => {
    if (location.baseId || !databases) return;
    const firstGroup = databases.find((group) => group.bases.length > 0);
    if (firstGroup)
      setLocation({
        spaceName: firstGroup.space.name,
        baseId: firstGroup.bases[0].id,
        baseName: firstGroup.bases[0].name,
      });
  }, [databases, location.baseId]);

  const handleSelectTable = useCallback(
    (tableSelection: TCyberneticsTableSelection) => {
      const nextLocation = {
        spaceName: tableSelection.spaceName,
        baseId: tableSelection.baseId,
        baseName: tableSelection.baseName,
        tableId: tableSelection.table.id,
        tableName: tableSelection.table.name,
      };
      setLocation(nextLocation);
      setViewerRecordId(undefined);
      writeLastLocation(projectId, nextLocation);
    },
    [projectId]
  );

  const isRecordAttached = (tableId: string, recordId: string) =>
    attachedRecords.some((record) => record.table_id === tableId && record.record_id === recordId);

  const toggleRecord = (tableId: string, recordId: string, name: string) => {
    const key = selectionKey(tableId, recordId);
    if (selection[key]) {
      setSelection((prev) => {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      });
      return;
    }
    if (!location.baseId) return;
    if (isSelectionFull) {
      setToast({
        type: TOAST_TYPE.WARNING,
        title: t("cybernetics_data.browser.max_selected", { count: CYBERNETICS_DATA_MAX_ATTACH }),
      });
      return;
    }
    const record = { baseId: location.baseId, tableId, recordId, name, tableName: location.tableName ?? "" };
    setSelection((prev) => ({ ...prev, [key]: record }));
  };

  const handleAttach = async () => {
    if (selectedRecords.length === 0) return;
    setIsAttaching(true);
    setFailedRecordIds([]);
    try {
      const response = await attachIssueRecords(
        workspaceSlug,
        projectId,
        workItemId,
        selectedRecords.map((record) => ({
          base_id: record.baseId,
          table_id: record.tableId,
          record_id: record.recordId,
        }))
      );
      const createdCount = response?.created?.length ?? 0;
      const skippedCount = response?.skipped?.length ?? 0;
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("cybernetics_data.toast.attached", { count: createdCount }),
        message: skippedCount > 0 ? t("cybernetics_data.toast.skipped", { count: skippedCount }) : undefined,
      });
      closeBrowser();
    } catch (error) {
      const failed = (error as TCyberneticsError | undefined)?.failed ?? [];
      setFailedRecordIds(failed.map((item) => selectionKey(item.table_id, item.record_id)));
      setToast({
        type: TOAST_TYPE.ERROR,
        title:
          failed.length > 0
            ? t("cybernetics_data.toast.attach_failed", { count: failed.length })
            : t(getCyberneticsErrorI18nKey(error)),
      });
    } finally {
      setIsAttaching(false);
    }
  };

  const breadcrumb = [location.spaceName, location.baseName, location.tableName].filter(Boolean).join(" › ");

  const renderBody = () => {
    if (!isActive) return <CyberneticsBrowserNotConfigured workspaceSlug={workspaceSlug} projectId={projectId} />;
    if (isViewMode && browserModal.target)
      return (
        <div className="h-[70vh]">
          <CyberneticsRecordViewer
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            baseId={browserModal.target.baseId}
            tableId={browserModal.target.tableId}
            recordId={browserModal.target.recordId}
          />
        </div>
      );
    return (
      <div className="flex h-[70vh] min-h-0 flex-col md:flex-row">
        <div className="flex max-h-48 w-full flex-shrink-0 flex-col border-b border-subtle p-3 md:max-h-none md:w-64 md:border-r md:border-b-0">
          <CyberneticsDatabaseTree
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            databases={databases}
            error={databasesError}
            isLoading={isDatabasesLoading}
            onRetry={() => void mutateDatabases()}
            selectedBaseId={location.baseId}
            selectedTableId={location.tableId}
            onSelectTable={handleSelectTable}
          />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {location.baseId && location.tableId && viewerRecordId ? (
            <CyberneticsRecordViewer
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              baseId={location.baseId}
              tableId={location.tableId}
              recordId={viewerRecordId}
              breadcrumb={breadcrumb}
              onBack={() => setViewerRecordId(undefined)}
              selection={{
                isSelected:
                  isRecordAttached(location.tableId, viewerRecordId) ||
                  !!selection[selectionKey(location.tableId, viewerRecordId)],
                isDisabled:
                  isRecordAttached(location.tableId, viewerRecordId) ||
                  isSelectionDisabled(location.tableId, viewerRecordId),
                onToggle: (name) => location.tableId && toggleRecord(location.tableId, viewerRecordId, name),
              }}
            />
          ) : location.baseId && location.tableId ? (
            <div className="flex h-full min-h-0 flex-col p-3">
              <CyberneticsRecordsPane
                key={location.tableId}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                baseId={location.baseId}
                tableId={location.tableId}
                breadcrumb={breadcrumb}
                isRecordSelected={(recordId) => !!selection[selectionKey(location.tableId ?? "", recordId)]}
                isRecordAttached={(recordId) => isRecordAttached(location.tableId ?? "", recordId)}
                isSelectionDisabled={(recordId) => isSelectionDisabled(location.tableId ?? "", recordId)}
                onToggleRecord={(record: TCyberneticsRecord, name: string) =>
                  location.tableId && toggleRecord(location.tableId, record.id, name)
                }
                onOpenRecord={setViewerRecordId}
              />
            </div>
          ) : (
            <p className="flex h-full items-center justify-center p-6 text-body-xs-regular text-tertiary">
              {t("cybernetics_data.browser.select_table")}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={closeBrowser} position={EModalPosition.TOP} width={EModalWidth.VIXL}>
      <div className="flex items-center justify-between gap-3 border-b border-subtle px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="text-h5-medium text-primary">{t("cybernetics_data.browser.title")}</h3>
          <span className="truncate text-body-xs-regular text-tertiary">
            {isViewMode
              ? t("cybernetics_data.browser.view_subtitle")
              : t("cybernetics_data.browser.subtitle", { identifier })}
          </span>
        </div>
        <button
          type="button"
          onClick={closeBrowser}
          className="grid place-items-center rounded-sm p-1 text-placeholder hover:bg-layer-transparent-hover hover:text-primary"
          aria-label={t("cybernetics_data.browser.cancel")}
        >
          <X className="size-4" />
        </button>
      </div>
      {renderBody()}
      {isActive && !isViewMode && (
        <div className="flex items-center justify-between gap-3 border-t border-subtle px-4 py-3">
          <CyberneticsSelectedChips
            selection={selectedRecords}
            failedRecordIds={failedRecordIds}
            maxCount={CYBERNETICS_DATA_MAX_ATTACH}
            onRemove={(record) => toggleRecord(record.tableId, record.recordId, record.name)}
          />
          <div className="ml-auto flex flex-shrink-0 items-center gap-2">
            <Button variant="secondary" size="lg" onClick={closeBrowser}>
              {t("cybernetics_data.browser.cancel")}
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={handleAttach}
              loading={isAttaching}
              disabled={!canAttach || selectedRecords.length === 0}
            >
              {isAttaching
                ? t("cybernetics_data.browser.attaching")
                : t("cybernetics_data.browser.attach_n", { count: selectedRecords.length })}
            </Button>
          </div>
        </div>
      )}
    </ModalCore>
  );
});
