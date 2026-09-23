/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
// plane imports
import {
  CYBERNETICS_DATA_MAX_COLUMNS,
  CYBERNETICS_DATA_PAGE_SIZE,
  CYBERNETICS_RECORDS_KEY,
  CYBERNETICS_SCHEMA_KEY,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { EmptyStateCompact } from "@plane/propel/empty-state";
import type { TCyberneticsOrder, TCyberneticsRecord, TCyberneticsRecordsQuery } from "@plane/types";
// hooks
import useDebounce from "@/hooks/use-debounce";
// plane web imports
import { CyberneticsDataService } from "@/plane-web/services/cybernetics-data.service";
// local imports
import { CyberneticsErrorBanner } from "./error-banner";
import type { TCyberneticsFilterDraft } from "./filter-popover";
import { buildCyberneticsFilter } from "./filter-popover";
import { CyberneticsRecordsPagination } from "./records-pagination";
import { CyberneticsRecordsTable } from "./records-table";
import { CyberneticsRecordsToolbar } from "./records-toolbar";

const cyberneticsDataService = new CyberneticsDataService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  baseId: string;
  tableId: string;
  breadcrumb: string;
  isRecordSelected: (recordId: string) => boolean;
  isRecordAttached: (recordId: string) => boolean;
  isSelectionDisabled: (recordId: string) => boolean;
  onToggleRecord: (record: TCyberneticsRecord, recordName: string) => void;
  onOpenRecord: (recordId: string) => void;
};

export function CyberneticsRecordsPane(props: Props) {
  const {
    workspaceSlug,
    projectId,
    baseId,
    tableId,
    breadcrumb,
    isRecordSelected,
    isRecordAttached,
    isSelectionDisabled,
    onToggleRecord,
    onOpenRecord,
  } = props;
  // states
  const [viewId, setViewId] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState<string | undefined>(undefined);
  const [searchField, setSearchField] = useState<string | undefined>(undefined);
  const [filters, setFilters] = useState<TCyberneticsFilterDraft[]>([]);
  const [order, setOrder] = useState<TCyberneticsOrder | undefined>(undefined);
  // paging is tied to the result set it was made for, so a query change starts at skip 0 in the same render
  const [page, setPage] = useState<{ key: string; skip: number; total?: number }>({ key: "", skip: 0 });
  // translation
  const { t } = useTranslation();
  // derived values
  const debouncedSearch = useDebounce(searchInput, 400);
  const search = (submittedSearch ?? debouncedSearch).trim();

  // fetch schema
  const {
    data: schema,
    error: schemaError,
    isLoading: isSchemaLoading,
    mutate: mutateSchema,
  } = useSWR(
    CYBERNETICS_SCHEMA_KEY(projectId, baseId, tableId),
    () => cyberneticsDataService.getSchema(workspaceSlug, projectId, tableId, { base_id: baseId }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const fields = useMemo(() => schema?.fields ?? [], [schema]);
  const primaryField = fields.find((field) => field.is_primary);
  const columns = fields
    .filter((field) => !field.is_primary && field.type !== "button")
    .slice(0, CYBERNETICS_DATA_MAX_COLUMNS);
  const filter = useMemo(() => buildCyberneticsFilter(filters, fields), [filters, fields]);

  // query (without skip) identifies the result set; the total is only requested for the first page
  const baseQuery = useMemo(
    () => ({
      base_id: baseId,
      take: CYBERNETICS_DATA_PAGE_SIZE,
      view_id: viewId,
      search: search || undefined,
      search_field: search ? searchField : undefined,
      filter,
      order_by: order ? [order] : undefined,
    }),
    [baseId, viewId, search, searchField, filter, order]
  );
  const baseQueryKey = useMemo(() => JSON.stringify(baseQuery), [baseQuery]);
  const isCurrentPage = page.key === baseQueryKey;
  const skip = isCurrentPage ? page.skip : 0;
  const total = isCurrentPage ? page.total : undefined;
  const query: TCyberneticsRecordsQuery = { ...baseQuery, skip, with_total: skip === 0 };

  // fetch records
  const {
    data: recordsResponse,
    error: recordsError,
    isLoading: isRecordsLoading,
    mutate: mutateRecords,
  } = useSWR(
    schema ? CYBERNETICS_RECORDS_KEY(projectId, tableId, query) : null,
    schema ? () => cyberneticsDataService.listRecords(workspaceSlug, projectId, tableId, query) : null,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      keepPreviousData: true,
    }
  );

  // remember the total from the first page of the current result set
  useEffect(() => {
    const responseTotal = recordsResponse?.total;
    if (responseTotal === undefined) return;
    setPage((prev) =>
      prev.key === baseQueryKey
        ? { ...prev, total: responseTotal }
        : { key: baseQueryKey, skip: 0, total: responseTotal }
    );
  }, [recordsResponse, baseQueryKey]);

  const records = recordsResponse?.records ?? [];
  const isFiltered = !!search || !!filter || !!viewId;
  const error = schemaError ?? recordsError;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <CyberneticsRecordsToolbar
        breadcrumb={breadcrumb}
        fields={fields}
        views={schema?.views ?? []}
        viewId={viewId}
        onViewChange={setViewId}
        search={searchInput}
        onSearchChange={(value) => {
          setSearchInput(value);
          setSubmittedSearch(undefined);
        }}
        onSearchSubmit={() => setSubmittedSearch(searchInput)}
        searchField={searchField}
        onSearchFieldChange={setSearchField}
        filters={filters}
        onFiltersChange={setFilters}
        order={order}
        onOrderChange={setOrder}
      />
      {error && (
        <CyberneticsErrorBanner
          error={error}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          onRetry={() => void (schemaError ? mutateSchema() : mutateRecords())}
        />
      )}
      <div className="vertical-scrollbar horizontal-scrollbar scrollbar-sm min-h-0 flex-1 overflow-auto rounded-md border border-subtle">
        {!error && !isSchemaLoading && !isRecordsLoading && records.length === 0 ? (
          <div className="flex h-full min-h-[200px] items-center justify-center p-6">
            <EmptyStateCompact
              assetKey="search"
              title={isFiltered ? t("cybernetics_data.browser.no_records") : t("cybernetics_data.browser.table_empty")}
            />
          </div>
        ) : (
          !error && (
            <CyberneticsRecordsTable
              columns={columns}
              primaryField={primaryField}
              records={records}
              isLoading={isSchemaLoading || (isRecordsLoading && !recordsResponse)}
              isRecordSelected={isRecordSelected}
              isRecordAttached={isRecordAttached}
              isSelectionDisabled={isSelectionDisabled}
              onToggleRecord={onToggleRecord}
              onOpenRecord={onOpenRecord}
            />
          )
        )}
      </div>
      {!error && (
        <CyberneticsRecordsPagination
          skip={skip}
          take={CYBERNETICS_DATA_PAGE_SIZE}
          pageCount={records.length}
          total={total}
          isLoading={isRecordsLoading}
          onChange={(nextSkip) => setPage({ key: baseQueryKey, skip: nextSkip, total })}
        />
      )}
    </div>
  );
}
