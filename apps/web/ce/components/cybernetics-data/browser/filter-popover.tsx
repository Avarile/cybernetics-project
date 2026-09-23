/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import type React from "react";
import { ListFilter, Plus, X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button, getButtonStyling } from "@plane/propel/button";
import { Popover } from "@plane/propel/popover";
import type {
  TCyberneticsCellValueType,
  TCyberneticsField,
  TCyberneticsFilter,
  TCyberneticsFilterOperator,
} from "@plane/types";
import { Input } from "@plane/ui";

export type TCyberneticsFilterDraft = {
  id: string;
  fieldId: string;
  operator: TCyberneticsFilterOperator;
  value: string;
};

const OPERATORS_BY_VALUE_TYPE: Record<TCyberneticsCellValueType, TCyberneticsFilterOperator[]> = {
  string: ["contains", "is", "isEmpty"],
  number: ["is", "isGreater", "isLess"],
  boolean: ["is"],
  dateTime: ["is", "isBefore", "isAfter"],
};

const VALUELESS_OPERATORS = new Set<TCyberneticsFilterOperator>(["isEmpty", "isNotEmpty"]);

// native selects are used inside the popover: portaled dropdowns would count as outside presses and close it
const SELECT_CLASS_NAME =
  "rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-1.5 py-1 text-13 text-primary focus:outline-none";

let draftSequence = 0;
const nextDraftId = () => `condition-${++draftSequence}`;

const getOperators = (field: TCyberneticsField | undefined) =>
  OPERATORS_BY_VALUE_TYPE[field?.cell_value_type ?? "string"] ?? OPERATORS_BY_VALUE_TYPE.string;

const toExactDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    mode: "exactDate",
    exactDate: date.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
};

/** Converts the simple v1 builder conditions (combined with AND) to a Cybernetics Data filter. */
export const buildCyberneticsFilter = (
  drafts: TCyberneticsFilterDraft[],
  fields: TCyberneticsField[]
): TCyberneticsFilter | undefined => {
  const filterSet = drafts
    .map((draft) => {
      const field = fields.find((f) => f.id === draft.fieldId);
      if (!field) return undefined;
      if (VALUELESS_OPERATORS.has(draft.operator))
        return { fieldId: draft.fieldId, operator: draft.operator, value: null };
      if (draft.value.trim() === "") return undefined;
      let value: unknown = draft.value;
      if (field.cell_value_type === "number") {
        value = Number(draft.value);
        if (Number.isNaN(value)) return undefined;
      } else if (field.cell_value_type === "boolean") {
        value = draft.value === "true";
      } else if (field.cell_value_type === "dateTime") {
        value = toExactDate(draft.value);
        if (!value) return undefined;
      }
      return { fieldId: draft.fieldId, operator: draft.operator, value };
    })
    .filter((condition): condition is NonNullable<typeof condition> => !!condition);
  return filterSet.length > 0 ? { conjunction: "and", filterSet } : undefined;
};

type Props = {
  fields: TCyberneticsField[];
  value: TCyberneticsFilterDraft[];
  onChange: (value: TCyberneticsFilterDraft[]) => void;
};

export function CyberneticsFilterPopover(props: Props) {
  const { fields, value, onChange } = props;
  // states
  const [isOpen, setIsOpen] = useState(false);
  const [drafts, setDrafts] = useState<TCyberneticsFilterDraft[]>(value);
  // translation
  const { t } = useTranslation();
  // derived values
  const filterableFields = fields.filter((field) => field.type !== "button" && field.type !== "attachment");

  const handleOpenChange = (open: boolean) => {
    if (open) setDrafts(value);
    setIsOpen(open);
  };

  // Escape closes only the popover, never the surrounding modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || !isOpen) return;
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);
  };

  const addCondition = () => {
    const field = filterableFields[0];
    if (!field) return;
    setDrafts((prev) => [
      ...prev,
      { id: nextDraftId(), fieldId: field.id, operator: getOperators(field)[0], value: "" },
    ]);
  };

  const updateCondition = (id: string, data: Partial<TCyberneticsFilterDraft>) =>
    setDrafts((prev) => prev.map((draft) => (draft.id === id ? { ...draft, ...data } : draft)));

  const removeCondition = (id: string) => setDrafts((prev) => prev.filter((draft) => draft.id !== id));

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <Popover.Button
        className={getButtonStyling(value.length > 0 ? "tertiary" : "secondary", "lg")}
        onKeyDown={handleKeyDown}
      >
        <ListFilter className="size-3.5" />
        {t("cybernetics_data.browser.filter")}
        {value.length > 0 && <span className="text-accent-primary">{value.length}</span>}
      </Popover.Button>
      <Popover.Panel
        side="bottom"
        align="end"
        positionerClassName="z-30"
        onKeyDown={handleKeyDown}
        className="flex w-[440px] max-w-[90vw] flex-col gap-2 rounded-md border border-subtle bg-surface-1 p-3 shadow-raised-200"
      >
        {drafts.map((draft) => {
          const field = filterableFields.find((f) => f.id === draft.fieldId);
          const operators = getOperators(field);
          const needsValue = !VALUELESS_OPERATORS.has(draft.operator);
          return (
            <div key={draft.id} className="flex items-center gap-2">
              <select
                value={draft.fieldId}
                aria-label={t("cybernetics_data.filter.field")}
                onChange={(e) => {
                  const nextField = filterableFields.find((f) => f.id === e.target.value);
                  updateCondition(draft.id, {
                    fieldId: e.target.value,
                    operator: getOperators(nextField)[0],
                    value: "",
                  });
                }}
                className={`${SELECT_CLASS_NAME} w-32`}
              >
                {filterableFields.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <select
                value={draft.operator}
                aria-label={t("cybernetics_data.filter.operator")}
                onChange={(e) => updateCondition(draft.id, { operator: e.target.value as TCyberneticsFilterOperator })}
                className={`${SELECT_CLASS_NAME} w-28`}
              >
                {operators.map((operator) => (
                  <option key={operator} value={operator}>
                    {t(`cybernetics_data.filter.operators.${operator}`)}
                  </option>
                ))}
              </select>
              {needsValue ? (
                field?.cell_value_type === "boolean" ? (
                  <select
                    value={draft.value}
                    aria-label={t("cybernetics_data.filter.value")}
                    onChange={(e) => updateCondition(draft.id, { value: e.target.value })}
                    className={`${SELECT_CLASS_NAME} min-w-0 flex-1`}
                  >
                    <option value="">{t("cybernetics_data.filter.value")}</option>
                    <option value="true">{t("cybernetics_data.filter.true")}</option>
                    <option value="false">{t("cybernetics_data.filter.false")}</option>
                  </select>
                ) : (
                  <Input
                    type={
                      field?.cell_value_type === "number"
                        ? "number"
                        : field?.cell_value_type === "dateTime"
                          ? "date"
                          : "text"
                    }
                    value={draft.value}
                    onChange={(e) => updateCondition(draft.id, { value: e.target.value })}
                    placeholder={t("cybernetics_data.filter.value")}
                    aria-label={t("cybernetics_data.filter.value")}
                    inputSize="xs"
                    className="min-w-0 flex-1"
                  />
                )
              ) : (
                <span className="flex-1" />
              )}
              <button
                type="button"
                onClick={() => removeCondition(draft.id)}
                aria-label={t("cybernetics_data.filter.remove_condition")}
                className="grid flex-shrink-0 place-items-center rounded-sm p-1 text-placeholder hover:bg-layer-transparent-hover hover:text-primary"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={addCondition}
            disabled={filterableFields.length === 0 || drafts.length >= 20}
          >
            <Plus className="size-3" />
            {t("cybernetics_data.filter.add_condition")}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDrafts([]);
                onChange([]);
                setIsOpen(false);
              }}
            >
              {t("cybernetics_data.filter.clear")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onChange(drafts);
                setIsOpen(false);
              }}
            >
              {t("cybernetics_data.filter.apply")}
            </Button>
          </div>
        </div>
      </Popover.Panel>
    </Popover>
  );
}
