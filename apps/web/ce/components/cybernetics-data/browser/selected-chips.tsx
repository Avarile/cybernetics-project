/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";

export type TCyberneticsSelectedRecord = {
  baseId: string;
  tableId: string;
  recordId: string;
  name: string;
  tableName: string;
};

type Props = {
  selection: TCyberneticsSelectedRecord[];
  failedRecordIds: string[]; // `${tableId}:${recordId}`
  maxCount: number;
  onRemove: (record: TCyberneticsSelectedRecord) => void;
};

export function CyberneticsSelectedChips(props: Props) {
  const { selection, failedRecordIds, maxCount, onRemove } = props;
  // translation
  const { t } = useTranslation();

  if (selection.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="flex-shrink-0 text-caption-sm-medium text-tertiary">
        {t("cybernetics_data.browser.selected", { count: selection.length })}
      </span>
      {selection.length >= maxCount && (
        <span className="flex-shrink-0 text-caption-sm-regular text-warning-primary">
          {t("cybernetics_data.browser.max_selected", { count: maxCount })}
        </span>
      )}
      <div className="horizontal-scrollbar flex scrollbar-sm min-w-0 items-center gap-1 overflow-x-auto">
        {selection.map((record) => {
          const isFailed = failedRecordIds.includes(`${record.tableId}:${record.recordId}`);
          return (
            <span
              key={`${record.tableId}:${record.recordId}`}
              className={cn(
                "flex max-w-48 flex-shrink-0 items-center gap-1 rounded-sm border border-subtle bg-layer-1 px-1.5 py-0.5 text-caption-sm-regular text-secondary",
                { "border-danger-strong text-danger-primary": isFailed }
              )}
            >
              <span className="truncate">
                {record.tableName} › {record.name}
              </span>
              <button
                type="button"
                onClick={() => onRemove(record)}
                className="flex-shrink-0 text-placeholder hover:text-primary"
                aria-label={t("cybernetics_data.browser.remove_selected", { name: record.name })}
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
