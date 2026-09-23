/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Search } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TCyberneticsField, TCyberneticsOrder, TCyberneticsView } from "@plane/types";
import { CustomSelect } from "@plane/ui";
// local imports
import type { TCyberneticsFilterDraft } from "./filter-popover";
import { CyberneticsFilterPopover } from "./filter-popover";
import { CyberneticsSortPopover } from "./sort-popover";

const ALL = "__all__";

type Props = {
  breadcrumb: string;
  fields: TCyberneticsField[];
  views: TCyberneticsView[];
  viewId: string | undefined;
  onViewChange: (viewId: string | undefined) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  searchField: string | undefined;
  onSearchFieldChange: (fieldId: string | undefined) => void;
  filters: TCyberneticsFilterDraft[];
  onFiltersChange: (value: TCyberneticsFilterDraft[]) => void;
  order: TCyberneticsOrder | undefined;
  onOrderChange: (value: TCyberneticsOrder | undefined) => void;
};

export function CyberneticsRecordsToolbar(props: Props) {
  const {
    breadcrumb,
    fields,
    views,
    viewId,
    onViewChange,
    search,
    onSearchChange,
    onSearchSubmit,
    searchField,
    onSearchFieldChange,
    filters,
    onFiltersChange,
    order,
    onOrderChange,
  } = props;
  // translation
  const { t } = useTranslation();
  // derived values
  const selectedView = views.find((view) => view.id === viewId);
  const selectedSearchField = fields.find((field) => field.id === searchField);
  const searchableFields = fields.filter((field) => field.type !== "button" && field.type !== "attachment");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-caption-sm-medium text-tertiary">{breadcrumb}</p>
        {views.length > 0 && (
          <CustomSelect
            value={viewId ?? ALL}
            label={
              <span className="truncate">
                {t("cybernetics_data.browser.view")}:{" "}
                {selectedView ? selectedView.name : t("cybernetics_data.browser.default_view")}
              </span>
            }
            onChange={(val: string) => onViewChange(val === ALL ? undefined : val)}
            buttonClassName="max-w-52"
            maxHeight="md"
            placement="bottom-end"
          >
            <CustomSelect.Option value={ALL}>{t("cybernetics_data.browser.default_view")}</CustomSelect.Option>
            {views.map((view) => (
              <CustomSelect.Option key={view.id} value={view.id}>
                <span className="truncate">{view.name}</span>
              </CustomSelect.Option>
            ))}
          </CustomSelect>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-md border border-subtle px-2 py-1">
          <Search className="size-3.5 flex-shrink-0 text-placeholder" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearchSubmit();
              }
            }}
            placeholder={t("cybernetics_data.browser.search_placeholder")}
            aria-label={t("cybernetics_data.browser.search_placeholder")}
            className="w-full bg-transparent text-body-xs-regular text-primary outline-none placeholder:text-placeholder"
          />
        </div>
        <CustomSelect
          value={searchField ?? ALL}
          label={
            <span className="truncate">
              {selectedSearchField ? selectedSearchField.name : t("cybernetics_data.browser.all_fields")}
            </span>
          }
          onChange={(val: string) => onSearchFieldChange(val === ALL ? undefined : val)}
          buttonClassName="h-7 max-w-40"
          maxHeight="md"
        >
          <CustomSelect.Option value={ALL}>{t("cybernetics_data.browser.all_fields")}</CustomSelect.Option>
          {searchableFields.map((field) => (
            <CustomSelect.Option key={field.id} value={field.id}>
              <span className="truncate">{field.name}</span>
            </CustomSelect.Option>
          ))}
        </CustomSelect>
        <CyberneticsFilterPopover fields={fields} value={filters} onChange={onFiltersChange} />
        <CyberneticsSortPopover fields={fields} value={order} onChange={onOrderChange} />
      </div>
    </div>
  );
}
