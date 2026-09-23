/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Database, Eye, ExternalLink, RefreshCw } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CopyIcon, TrashIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssueCyberneticsRecord } from "@plane/types";
import { CustomMenu } from "@plane/ui";
import { calculateTimeAgo, cn, copyTextToClipboard } from "@plane/utils";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web imports
import { useCyberneticsData } from "@/plane-web/hooks/store/use-cybernetics-data";
// local imports
import { getCyberneticsErrorI18nKey, getSafeExternalUrl } from "../helpers";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  record: TIssueCyberneticsRecord;
  canView: boolean;
  canRefresh: boolean;
  canRemove: boolean;
};

export const CyberneticsRecordItem = observer(function CyberneticsRecordItem(props: Props) {
  const { workspaceSlug, projectId, issueId, record, canView, canRefresh, canRemove } = props;
  // states
  const [isBusy, setIsBusy] = useState(false);
  // translation
  const { t } = useTranslation();
  // store hooks
  const { openBrowser, refreshIssueRecords, removeIssueRecord } = useCyberneticsData();
  const { isMobile } = usePlatformOS();
  // derived values
  const deepLink = getSafeExternalUrl(record.deep_link) ?? getSafeExternalUrl(record.source_url);
  const isMissing = record.status === "missing";
  const isForbidden = record.status === "forbidden";
  const isClickable = canView && !isMissing;
  const recordName = record.record_name || record.record_id;
  const previewLine = Object.entries(record.preview ?? {})
    .filter(([, value]) => typeof value === "string" && value.trim() !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
  const showMenu = canView || canRefresh || canRemove || !!deepLink;

  const handleView = () => {
    if (!isClickable) return;
    openBrowser(issueId, "view", { baseId: record.base_id, tableId: record.table_id, recordId: record.record_id });
  };

  const handleRefresh = async () => {
    setIsBusy(true);
    try {
      await refreshIssueRecords(workspaceSlug, projectId, issueId, [record.id]);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("cybernetics_data.toast.refreshed") });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t(getCyberneticsErrorI18nKey(error)) });
    } finally {
      setIsBusy(false);
    }
  };

  const handleRemove = async () => {
    setIsBusy(true);
    try {
      await removeIssueRecord(workspaceSlug, projectId, issueId, record.id);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("cybernetics_data.toast.removed") });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t(getCyberneticsErrorI18nKey(error)) });
      setIsBusy(false);
    }
  };

  const handleCopyLink = () => {
    if (!deepLink) return;
    void copyTextToClipboard(deepLink).then(() =>
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("common.link_copied"),
        message: t("common.link_copied_to_clipboard"),
      })
    );
  };

  const rowContent = (
    <>
      <Database className="mt-0.5 size-4 flex-shrink-0 text-tertiary group-hover:text-primary" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-body-xs-medium text-primary", { "line-through": isMissing })}>
            {recordName}
          </span>
          <span className="flex-shrink-0 truncate text-caption-sm-regular text-placeholder">
            {record.table_name} · {record.base_name}
          </span>
        </span>
        {(isMissing || isForbidden) && (
          <span className="text-caption-sm-regular text-danger-primary">
            {isMissing ? t("cybernetics_data.item.missing") : t("cybernetics_data.item.forbidden")}
          </span>
        )}
        {previewLine && <span className="line-clamp-1 text-caption-sm-regular text-tertiary">{previewLine}</span>}
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "group flex flex-shrink-0 items-start justify-between gap-3 rounded-sm border-[0.5px] border-subtle bg-layer-1 px-3 py-2 hover:bg-layer-1-hover",
        { "opacity-60": isBusy }
      )}
    >
      {isClickable ? (
        <button
          type="button"
          onClick={handleView}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left"
        >
          {rowContent}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-2.5">{rowContent}</div>
      )}
      <div className="flex flex-shrink-0 items-center gap-1">
        <p className="p-1 text-caption-sm-regular leading-5 text-placeholder">{calculateTimeAgo(record.created_at)}</p>
        {deepLink && (
          <Tooltip tooltipContent={t("cybernetics_data.item.open_external")} isMobile={isMobile}>
            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="grid place-items-center rounded-sm p-1 text-placeholder group-hover:text-secondary hover:bg-layer-1-hover"
              aria-label={t("cybernetics_data.item.open_external")}
            >
              <ExternalLink className="h-3.5 w-3.5 stroke-[1.5]" />
            </a>
          </Tooltip>
        )}
        {showMenu && (
          <CustomMenu
            ellipsis
            buttonClassName="text-placeholder group-hover:text-secondary"
            placement="bottom-end"
            closeOnSelect
            disabled={isBusy}
          >
            {isClickable && (
              <CustomMenu.MenuItem className="flex items-center gap-2" onClick={handleView}>
                <Eye className="h-3 w-3 stroke-[1.5] text-secondary" />
                {t("cybernetics_data.item.view")}
              </CustomMenu.MenuItem>
            )}
            {canRefresh && (
              <CustomMenu.MenuItem className="flex items-center gap-2" onClick={handleRefresh}>
                <RefreshCw className="h-3 w-3 stroke-[1.5] text-secondary" />
                {t("cybernetics_data.item.refresh")}
              </CustomMenu.MenuItem>
            )}
            {deepLink && (
              <CustomMenu.MenuItem className="flex items-center gap-2" onClick={handleCopyLink}>
                <CopyIcon className="h-3 w-3 stroke-[1.5] text-secondary" />
                {t("cybernetics_data.item.copy_link")}
              </CustomMenu.MenuItem>
            )}
            {canRemove && (
              <CustomMenu.MenuItem className="flex items-center gap-2" onClick={handleRemove}>
                <TrashIcon className="h-3 w-3" />
                {t("cybernetics_data.item.remove")}
              </CustomMenu.MenuItem>
            )}
          </CustomMenu>
        )}
      </div>
    </div>
  );
});
