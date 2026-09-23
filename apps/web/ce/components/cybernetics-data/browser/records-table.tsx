/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Maximize2 } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@plane/propel/table";
import { Tooltip } from "@plane/propel/tooltip";
import type { TCyberneticsField, TCyberneticsRecord } from "@plane/types";
import { Checkbox, Loader } from "@plane/ui";
// local imports
import { stringifyCellValue } from "../viewer/field-value";

type Props = {
  columns: TCyberneticsField[];
  primaryField: TCyberneticsField | undefined;
  records: TCyberneticsRecord[];
  isLoading: boolean;
  isRecordSelected: (recordId: string) => boolean;
  isRecordAttached: (recordId: string) => boolean;
  isSelectionDisabled: (recordId: string) => boolean;
  onToggleRecord: (record: TCyberneticsRecord, recordName: string) => void;
  onOpenRecord: (recordId: string) => void;
};

export const getRecordDisplayName = (record: TCyberneticsRecord, primaryField: TCyberneticsField | undefined) =>
  record.name || (primaryField ? stringifyCellValue(record.fields?.[primaryField.id]) : "") || record.id;

export function CyberneticsRecordsTable(props: Props) {
  const {
    columns,
    primaryField,
    records,
    isLoading,
    isRecordSelected,
    isRecordAttached,
    isSelectionDisabled,
    onToggleRecord,
    onOpenRecord,
  } = props;
  // translation
  const { t } = useTranslation();

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10" />
          <TableHead className="w-56 truncate">{primaryField?.name ?? ""}</TableHead>
          {columns.map((field) => (
            <TableHead key={field.id} className="w-40 truncate" title={field.name}>
              {field.name}
            </TableHead>
          ))}
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading
          ? Array.from({ length: 8 }).map((_, index) => (
              <TableRow key={index}>
                <TableCell colSpan={columns.length + 3}>
                  <Loader>
                    <Loader.Item height="20px" />
                  </Loader>
                </TableCell>
              </TableRow>
            ))
          : records.map((record) => {
              const recordName = getRecordDisplayName(record, primaryField);
              const isAttached = isRecordAttached(record.id);
              const isSelected = isAttached || isRecordSelected(record.id);
              const isDisabled = isAttached || isSelectionDisabled(record.id);
              const checkbox = (
                <Checkbox
                  checked={isSelected}
                  disabled={isDisabled}
                  onChange={() => onToggleRecord(record, recordName)}
                  aria-label={recordName}
                />
              );
              return (
                <TableRow
                  key={record.id}
                  tabIndex={0}
                  data-state={isSelected ? "selected" : undefined}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === " " && !isDisabled) {
                      e.preventDefault();
                      onToggleRecord(record, recordName);
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      onOpenRecord(record.id);
                    }
                  }}
                  aria-selected={isSelected}
                  className="border-b border-subtle outline-none hover:bg-layer-transparent-hover focus-visible:bg-layer-transparent-hover"
                >
                  <TableCell className="w-10">
                    {isAttached ? (
                      <Tooltip tooltipContent={t("cybernetics_data.browser.already_attached")}>
                        <span className="inline-flex">{checkbox}</span>
                      </Tooltip>
                    ) : (
                      checkbox
                    )}
                  </TableCell>
                  <TableCell className="truncate font-medium text-primary" title={recordName}>
                    {recordName}
                  </TableCell>
                  {columns.map((field) => {
                    const value = stringifyCellValue(record.fields?.[field.id]);
                    return (
                      <TableCell key={field.id} className="truncate text-secondary" title={value}>
                        {value}
                      </TableCell>
                    );
                  })}
                  <TableCell className="w-10">
                    <button
                      type="button"
                      onClick={() => onOpenRecord(record.id)}
                      className="grid place-items-center rounded-sm p-1 text-placeholder hover:bg-layer-transparent-hover hover:text-primary"
                      aria-label={t("cybernetics_data.browser.view_record")}
                    >
                      <Maximize2 className="size-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
      </TableBody>
    </Table>
  );
}
