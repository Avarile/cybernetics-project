/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";

type Props = {
  skip: number;
  take: number;
  pageCount: number;
  total: number | undefined;
  isLoading: boolean;
  onChange: (skip: number) => void;
};

export function CyberneticsRecordsPagination(props: Props) {
  const { skip, take, pageCount, total, isLoading, onChange } = props;
  // translation
  const { t } = useTranslation();
  // derived values
  const from = pageCount > 0 ? skip + 1 : 0;
  const to = skip + pageCount;
  const hasPrevious = skip > 0;
  const hasNext = total !== undefined ? to < total : pageCount === take;

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-caption-sm-regular text-tertiary">
        {total !== undefined
          ? t("cybernetics_data.browser.pagination", {
              from: from.toLocaleString(),
              to: to.toLocaleString(),
              total: total.toLocaleString(),
            })
          : t("cybernetics_data.browser.pagination_no_total", { from: from.toLocaleString(), to: to.toLocaleString() })}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="lg"
          disabled={!hasPrevious || isLoading}
          onClick={() => onChange(Math.max(0, skip - take))}
        >
          <ChevronLeft className="size-3.5" />
          {t("cybernetics_data.browser.previous")}
        </Button>
        <Button variant="secondary" size="lg" disabled={!hasNext || isLoading} onClick={() => onChange(skip + take)}>
          {t("cybernetics_data.browser.next")}
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
