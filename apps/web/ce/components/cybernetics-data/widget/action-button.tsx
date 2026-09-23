/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { PlusIcon } from "@plane/propel/icons";
// plane web imports
import { useCyberneticsData } from "@/plane-web/hooks/store/use-cybernetics-data";

type Props = {
  workItemId: string;
  customButton?: React.ReactNode;
  disabled?: boolean;
};

export const CyberneticsDataActionButton = observer(function CyberneticsDataActionButton(props: Props) {
  const { workItemId, customButton, disabled = false } = props;
  // translation
  const { t } = useTranslation();
  // store hooks
  const { openBrowser } = useCyberneticsData();

  // handlers
  const handleOnClick = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    openBrowser(workItemId, "browse");
  };

  return (
    <button
      type="button"
      onClick={handleOnClick}
      disabled={disabled}
      aria-label={customButton ? undefined : t("cybernetics_data.widget.button")}
    >
      {customButton ? customButton : <PlusIcon className="h-4 w-4" />}
    </button>
  );
});
