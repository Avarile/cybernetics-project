/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Check, FileText, Star } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TCyberneticsField } from "@plane/types";
import { renderFormattedDate, renderFormattedTime } from "@plane/utils";
// local imports
import { getSafeExternalUrl } from "../helpers";

type Props = {
  field: TCyberneticsField;
  value: unknown;
};

type TChoice = { name?: string; color?: string };
type TUserValue = { id?: string; title?: string; email?: string; avatarUrl?: string };
type TLinkValue = { id?: string; title?: string };
type TAttachmentValue = {
  id?: string;
  name?: string;
  mimetype?: string;
  presignedUrl?: string;
  smThumbnailUrl?: string;
};

const LONG_TEXT_LIMIT = 280;

const toArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [value as T]);

/** Converts any cell value to a plain string. External values are always rendered as text. */
export const stringifyCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringifyCellValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (typeof objectValue.title === "string") return objectValue.title;
    if (typeof objectValue.name === "string") return objectValue.name;
    return JSON.stringify(value);
  }
  return "";
};

const isEmptyValue = (value: unknown) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

function Pill({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-sm border border-subtle bg-layer-1 px-1.5 py-0.5 text-caption-sm-regular text-primary"
      style={color ? { borderColor: color } : undefined}
    >
      {label}
    </span>
  );
}

function LongText({ value }: { value: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useTranslation();
  const isLong = value.length > LONG_TEXT_LIMIT;
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="break-words whitespace-pre-wrap">
        {isLong && !isExpanded ? `${value.slice(0, LONG_TEXT_LIMIT)}…` : value}
      </p>
      {isLong && (
        <button
          type="button"
          className="text-caption-sm-medium text-accent-primary hover:underline"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          {isExpanded ? t("cybernetics_data.viewer.show_less") : t("cybernetics_data.viewer.show_more")}
        </button>
      )}
    </div>
  );
}

const formatDate = (value: unknown, withTime: boolean) => {
  if (typeof value !== "string") return stringifyCellValue(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const formattedDate = renderFormattedDate(date) ?? value;
  return withTime ? `${formattedDate} ${renderFormattedTime(date, "24-hour")}` : formattedDate;
};

export function CyberneticsFieldValue(props: Props) {
  const { field, value } = props;
  // translation
  const { t } = useTranslation();

  if (isEmptyValue(value)) return <span className="text-placeholder">{t("cybernetics_data.viewer.empty_value")}</span>;

  switch (field.type) {
    case "longText":
      return <LongText value={stringifyCellValue(value)} />;
    case "number":
    case "autoNumber":
      return <span>{typeof value === "number" ? value.toLocaleString() : stringifyCellValue(value)}</span>;
    case "rating": {
      const rating = typeof value === "number" ? Math.max(0, Math.min(10, Math.round(value))) : 0;
      return (
        <span className="flex items-center gap-0.5" aria-label={String(value)}>
          {Array.from({ length: rating }).map((_, index) => (
            <Star key={index} className="size-3.5 fill-current text-warning-primary" />
          ))}
        </span>
      );
    }
    case "checkbox":
      return value === true ? (
        <Check className="size-4 text-success-primary" />
      ) : (
        <span>{stringifyCellValue(value)}</span>
      );
    case "singleSelect":
    case "multipleSelect": {
      const choices = (field.options_lite?.choices as TChoice[] | undefined) ?? [];
      return (
        <div className="flex flex-wrap gap-1">
          {toArray<unknown>(value).map((item, index) => {
            const label = stringifyCellValue(item);
            return (
              <Pill key={`${label}-${index}`} label={label} color={choices.find((c) => c.name === label)?.color} />
            );
          })}
        </div>
      );
    }
    case "date":
      return <span>{formatDate(value, false)}</span>;
    case "createdTime":
    case "lastModifiedTime":
      return <span>{formatDate(value, true)}</span>;
    case "user":
    case "createdBy":
    case "lastModifiedBy":
      return (
        <div className="flex flex-wrap gap-2">
          {toArray<TUserValue>(value).map((user, index) => {
            const avatarUrl = getSafeExternalUrl(user?.avatarUrl);
            return (
              <span key={user?.id ?? index} className="inline-flex items-center gap-1.5">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="size-4 rounded-full object-cover" />
                ) : (
                  <span className="grid size-4 place-items-center rounded-full bg-layer-3 text-[9px] uppercase">
                    {(user?.title ?? "?").charAt(0)}
                  </span>
                )}
                <span>{user?.title ?? user?.email ?? stringifyCellValue(user)}</span>
              </span>
            );
          })}
        </div>
      );
    case "attachment":
      return (
        <div className="flex flex-wrap gap-2">
          {toArray<TAttachmentValue>(value).map((attachment, index) => {
            const href = getSafeExternalUrl(attachment?.presignedUrl);
            const thumbnail = getSafeExternalUrl(attachment?.smThumbnailUrl);
            const content = thumbnail ? (
              <img src={thumbnail} alt={attachment?.name ?? ""} className="size-16 rounded-sm object-cover" />
            ) : (
              <span className="flex h-16 w-24 flex-col items-center justify-center gap-1 rounded-sm bg-layer-1 p-1">
                <FileText className="size-4 text-tertiary" />
                <span className="w-full truncate text-center text-caption-xs-regular">{attachment?.name}</span>
              </span>
            );
            return href ? (
              <a
                key={attachment?.id ?? index}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={attachment?.name}
                className="rounded-sm border border-subtle hover:border-strong"
              >
                {content}
              </a>
            ) : (
              <span key={attachment?.id ?? index} title={attachment?.name}>
                {content}
              </span>
            );
          })}
        </div>
      );
    case "link":
      return (
        <div className="flex flex-wrap gap-1">
          {toArray<TLinkValue>(value).map((link, index) => (
            <Pill key={link?.id ?? index} label={link?.title || link?.id || stringifyCellValue(link)} />
          ))}
        </div>
      );
    case "singleLineText":
    default:
      return <span className="break-words whitespace-pre-wrap">{stringifyCellValue(value)}</span>;
  }
}
