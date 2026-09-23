/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { ChevronDown, ChevronRight, Database, Lock, Search, Table2 } from "lucide-react";
// plane imports
import { CYBERNETICS_TABLES_KEY } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TCyberneticsDatabaseGroup, TCyberneticsTable } from "@plane/types";
import { Loader, Spinner } from "@plane/ui";
import { cn } from "@plane/utils";
// plane web imports
import { CyberneticsDataService } from "@/plane-web/services/cybernetics-data.service";
// local imports
import { getCyberneticsErrorKey } from "../helpers";
import { CyberneticsErrorBanner } from "./error-banner";

const cyberneticsDataService = new CyberneticsDataService();

export type TCyberneticsTableSelection = {
  spaceName: string;
  baseId: string;
  baseName: string;
  table: TCyberneticsTable;
};

type TBaseNodeProps = {
  workspaceSlug: string;
  projectId: string;
  spaceName: string;
  base: TCyberneticsDatabaseGroup["bases"][number];
  isExpanded: boolean;
  onToggle: () => void;
  selectedTableId?: string;
  autoSelectFirstTable: boolean;
  onSelectTable: (selection: TCyberneticsTableSelection) => void;
};

function BaseNode(props: TBaseNodeProps) {
  const {
    workspaceSlug,
    projectId,
    spaceName,
    base,
    isExpanded,
    onToggle,
    selectedTableId,
    autoSelectFirstTable,
    onSelectTable,
  } = props;
  // translation
  const { t } = useTranslation();
  // fetch tables lazily when expanded
  const {
    data: tables,
    error,
    isLoading,
  } = useSWR(
    isExpanded ? CYBERNETICS_TABLES_KEY(projectId, base.id) : null,
    isExpanded ? () => cyberneticsDataService.listTables(workspaceSlug, projectId, base.id) : null,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const isForbidden = getCyberneticsErrorKey(error) === "CYBERNETICS_FORBIDDEN";

  // select the first table of the initially selected base
  useEffect(() => {
    if (!autoSelectFirstTable || selectedTableId || !tables || tables.length === 0) return;
    onSelectTable({ spaceName, baseId: base.id, baseName: base.name, table: tables[0] });
  }, [autoSelectFirstTable, selectedTableId, tables, spaceName, base.id, base.name, onSelectTable]);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-body-xs-medium text-secondary hover:bg-layer-transparent-hover"
      >
        {isExpanded ? (
          <ChevronDown className="size-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="size-3 flex-shrink-0" />
        )}
        <Database className="size-3.5 flex-shrink-0 text-tertiary" />
        <span className="truncate">{base.name}</span>
        {isForbidden && (
          <span className="ml-auto flex flex-shrink-0 items-center gap-1 text-caption-sm-regular text-placeholder">
            <Lock className="size-3" />
            {t("cybernetics_data.browser.no_access")}
          </span>
        )}
        {isLoading && <Spinner height="12px" width="12px" className="ml-auto flex-shrink-0" />}
      </button>
      {isExpanded && (
        <div className="ml-5 flex flex-col border-l border-subtle pl-1">
          {isForbidden ? (
            <p className="px-2 py-1 text-caption-sm-regular text-placeholder">
              {t("cybernetics_data.browser.no_access_description")}
            </p>
          ) : error ? (
            <p className="px-2 py-1 text-caption-sm-regular text-danger-primary">
              {t("cybernetics_data.errors.generic")}
            </p>
          ) : tables && tables.length === 0 ? (
            <p className="px-2 py-1 text-caption-sm-regular text-placeholder">
              {t("cybernetics_data.browser.no_tables")}
            </p>
          ) : (
            tables?.map((table) => (
              <button
                key={table.id}
                type="button"
                onClick={() => onSelectTable({ spaceName, baseId: base.id, baseName: base.name, table })}
                aria-current={selectedTableId === table.id ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-body-xs-regular text-secondary hover:bg-layer-transparent-hover",
                  { "bg-layer-1 text-primary": selectedTableId === table.id }
                )}
              >
                <Table2 className="size-3.5 flex-shrink-0 text-tertiary" />
                <span className="truncate">{table.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

type Props = {
  workspaceSlug: string;
  projectId: string;
  databases: TCyberneticsDatabaseGroup[] | undefined;
  error: unknown;
  isLoading: boolean;
  onRetry: () => void;
  selectedBaseId?: string;
  selectedTableId?: string;
  onSelectTable: (selection: TCyberneticsTableSelection) => void;
};

export function CyberneticsDatabaseTree(props: Props) {
  const {
    workspaceSlug,
    projectId,
    databases,
    error,
    isLoading,
    onRetry,
    selectedBaseId,
    selectedTableId,
    onSelectTable,
  } = props;
  // states
  const [query, setQuery] = useState("");
  const [collapsedSpaces, setCollapsedSpaces] = useState<string[]>([]);
  const [expandedBases, setExpandedBases] = useState<string[]>(selectedBaseId ? [selectedBaseId] : []);
  // translation
  const { t } = useTranslation();

  // keep the selected base expanded
  useEffect(() => {
    if (selectedBaseId) setExpandedBases((prev) => (prev.includes(selectedBaseId) ? prev : [...prev, selectedBaseId]));
  }, [selectedBaseId]);

  const filteredDatabases = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();
    if (!normalisedQuery) return databases ?? [];
    return (databases ?? [])
      .map((group) => ({
        ...group,
        bases: group.space.name.toLowerCase().includes(normalisedQuery)
          ? group.bases
          : group.bases.filter((base) => base.name.toLowerCase().includes(normalisedQuery)),
      }))
      .filter((group) => group.bases.length > 0);
  }, [databases, query]);

  const toggleSpace = (spaceId: string) =>
    setCollapsedSpaces((prev) => (prev.includes(spaceId) ? prev.filter((id) => id !== spaceId) : [...prev, spaceId]));
  const toggleBase = (baseId: string) =>
    setExpandedBases((prev) => (prev.includes(baseId) ? prev.filter((id) => id !== baseId) : [...prev, baseId]));

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-subtle px-2 py-1">
        <Search className="size-3.5 flex-shrink-0 text-placeholder" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("cybernetics_data.browser.filter_databases")}
          aria-label={t("cybernetics_data.browser.filter_databases")}
          className="w-full bg-transparent text-body-xs-regular text-primary outline-none placeholder:text-placeholder"
        />
      </div>
      <div className="vertical-scrollbar scrollbar-sm min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <CyberneticsErrorBanner error={error} workspaceSlug={workspaceSlug} projectId={projectId} onRetry={onRetry} />
        ) : isLoading && !databases ? (
          <Loader className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Loader.Item key={index} height="24px" />
            ))}
          </Loader>
        ) : filteredDatabases.length === 0 ? (
          <p className="px-2 py-1 text-caption-sm-regular text-placeholder">
            {t("cybernetics_data.browser.no_databases")}
          </p>
        ) : (
          filteredDatabases.map((group) => {
            const isSpaceCollapsed = collapsedSpaces.includes(group.space.id);
            return (
              <div key={group.space.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => toggleSpace(group.space.id)}
                  className="flex w-full items-center gap-1.5 px-1 py-1 text-left text-caption-sm-medium text-tertiary uppercase hover:text-secondary"
                >
                  {isSpaceCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                  <span className="truncate">{group.space.name}</span>
                </button>
                {!isSpaceCollapsed &&
                  group.bases.map((base) => (
                    <BaseNode
                      key={base.id}
                      workspaceSlug={workspaceSlug}
                      projectId={projectId}
                      spaceName={group.space.name}
                      base={base}
                      isExpanded={expandedBases.includes(base.id)}
                      onToggle={() => toggleBase(base.id)}
                      selectedTableId={selectedBaseId === base.id ? selectedTableId : undefined}
                      autoSelectFirstTable={selectedBaseId === base.id}
                      onSelectTable={onSelectTable}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
