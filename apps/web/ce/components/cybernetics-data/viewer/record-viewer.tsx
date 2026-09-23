/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import { ChevronLeft, ExternalLink } from "lucide-react";
// plane imports
import { CYBERNETICS_RECORD_KEY } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { getButtonStyling } from "@plane/propel/button";
import { Checkbox, Loader } from "@plane/ui";
// plane web imports
import { CyberneticsDataService } from "@/plane-web/services/cybernetics-data.service";
// local imports
import { CyberneticsErrorBanner } from "../browser/error-banner";
import { getSafeExternalUrl } from "../helpers";
import { CyberneticsFieldValue } from "./field-value";

const cyberneticsDataService = new CyberneticsDataService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  baseId: string;
  tableId: string;
  recordId: string;
  breadcrumb?: string;
  onBack?: () => void;
  selection?: {
    isSelected: boolean;
    isDisabled: boolean;
    onToggle: (recordName: string) => void;
  };
};

export function CyberneticsRecordViewer(props: Props) {
  const { workspaceSlug, projectId, baseId, tableId, recordId, breadcrumb, onBack, selection } = props;
  // translation
  const { t } = useTranslation();
  // fetch
  const { data, error, isLoading, mutate } = useSWR(
    CYBERNETICS_RECORD_KEY(projectId, baseId, tableId, recordId),
    () =>
      cyberneticsDataService.getRecord(workspaceSlug, projectId, tableId, recordId, {
        base_id: baseId,
        cell_format: "json",
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  // derived values
  const record = data?.record;
  const recordName = record?.name || recordId;
  const deepLink = getSafeExternalUrl(data?.deep_link);
  const fields = (data?.fields ?? []).filter((field) => field.type !== "button");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-subtle px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex w-fit items-center gap-1 text-caption-sm-medium text-tertiary hover:text-primary"
            >
              <ChevronLeft className="size-3.5" />
              {t("cybernetics_data.browser.back")}
            </button>
          )}
          <h4 className="truncate text-h6-medium text-primary">{isLoading ? "…" : recordName}</h4>
          {breadcrumb && <p className="truncate text-caption-sm-regular text-tertiary">{breadcrumb}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          {selection && record && (
            <label className="flex cursor-pointer items-center gap-2 text-body-xs-medium text-secondary">
              <Checkbox
                checked={selection.isSelected}
                disabled={selection.isDisabled}
                onChange={() => selection.onToggle(recordName)}
              />
              {t("cybernetics_data.viewer.select")}
            </label>
          )}
          {deepLink && (
            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className={getButtonStyling("secondary", "lg")}
            >
              <ExternalLink className="size-3.5" />
              {t("cybernetics_data.browser.open_external")}
            </a>
          )}
        </div>
      </div>
      <div className="vertical-scrollbar scrollbar-sm min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error ? (
          <CyberneticsErrorBanner
            error={error}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            onRetry={() => void mutate()}
          />
        ) : isLoading || !record ? (
          <Loader className="flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Loader.Item key={index} height="28px" />
            ))}
          </Loader>
        ) : (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-body-xs-regular text-primary sm:grid-cols-[minmax(120px,200px)_1fr]">
            {fields.map((field) => (
              <div key={field.id} className="contents">
                <dt className="truncate text-tertiary" title={field.name}>
                  {field.name}
                </dt>
                <dd className="min-w-0">
                  <CyberneticsFieldValue
                    field={field}
                    value={record.fields?.[field.id] ?? record.fields?.[field.name]}
                  />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
