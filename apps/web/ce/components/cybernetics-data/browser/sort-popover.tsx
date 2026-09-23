/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TCyberneticsField, TCyberneticsOrder } from "@plane/types";
import { CustomSelect } from "@plane/ui";

type Props = {
  fields: TCyberneticsField[];
  value: TCyberneticsOrder | undefined;
  onChange: (value: TCyberneticsOrder | undefined) => void;
};

const NONE = "__none__";

export function CyberneticsSortPopover(props: Props) {
  const { fields, value, onChange } = props;
  // translation
  const { t } = useTranslation();
  // derived values
  const sortableFields = fields.filter((field) => field.type !== "button" && field.type !== "attachment");
  const selectedField = sortableFields.find((field) => field.id === value?.field_id);
  const DirectionIcon = value?.order === "desc" ? ArrowDownWideNarrow : ArrowUpNarrowWide;

  return (
    <div className="flex items-center gap-1">
      <CustomSelect
        value={value?.field_id ?? NONE}
        label={
          <span className="flex items-center gap-1 truncate">
            <DirectionIcon className="size-3.5 flex-shrink-0" />
            <span className="truncate">{selectedField ? selectedField.name : t("cybernetics_data.browser.sort")}</span>
          </span>
        }
        onChange={(fieldId: string) =>
          onChange(fieldId === NONE ? undefined : { field_id: fieldId, order: value?.order ?? "asc" })
        }
        buttonClassName="h-7 max-w-40"
        maxHeight="md"
        placement="bottom-end"
      >
        <CustomSelect.Option value={NONE}>{t("cybernetics_data.sort.none")}</CustomSelect.Option>
        {sortableFields.map((field) => (
          <CustomSelect.Option key={field.id} value={field.id}>
            <span className="truncate">{field.name}</span>
          </CustomSelect.Option>
        ))}
      </CustomSelect>
      {value && (
        <CustomSelect
          value={value.order}
          label={
            <span>{value.order === "desc" ? t("cybernetics_data.sort.desc") : t("cybernetics_data.sort.asc")}</span>
          }
          onChange={(order: "asc" | "desc") => onChange({ ...value, order })}
          buttonClassName="h-7"
          placement="bottom-end"
        >
          <CustomSelect.Option value="asc">{t("cybernetics_data.sort.asc")}</CustomSelect.Option>
          <CustomSelect.Option value="desc">{t("cybernetics_data.sort.desc")}</CustomSelect.Option>
        </CustomSelect>
      )}
    </div>
  );
}
