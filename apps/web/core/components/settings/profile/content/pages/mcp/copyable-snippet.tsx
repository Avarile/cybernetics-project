/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { useTranslation } from "@plane/i18n";
import { CopyIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/ui";
import { copyTextToClipboard } from "@plane/utils";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";

type Props = {
  value: string;
  /** Optional caption, e.g. the config file the snippet belongs in. */
  label?: string;
  className?: string;
};

export function CopyableSnippet(props: Props) {
  const { value, label, className } = props;
  const { isMobile } = usePlatformOS();
  const { t } = useTranslation();

  const handleCopy = () =>
    copyTextToClipboard(value).then(() =>
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `${t("success")}!`,
        message: t("account_settings.mcp.copied"),
      })
    );

  return (
    <div className={cn("w-full", className)}>
      {label && <p className="mb-1.5 text-11 text-placeholder">{label}</p>}
      <div className="relative rounded-md border-[0.5px] border-subtle bg-layer-2">
        <pre className="max-h-80 overflow-auto p-3 pr-11 text-12 leading-5 break-all whitespace-pre-wrap text-secondary">
          {value}
        </pre>
        <Tooltip tooltipContent={t("account_settings.mcp.copy")} isMobile={isMobile}>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={t("account_settings.mcp.copy")}
            className="absolute top-1.5 right-1.5 rounded p-1.5 text-placeholder outline-none hover:bg-layer-3 hover:text-secondary"
          >
            <CopyIcon className="size-4" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
