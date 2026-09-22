/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Tabs } from "@plane/propel/tabs";
import { Tooltip } from "@plane/propel/tooltip";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";
// local imports
import { CopyableSnippet } from "./copyable-snippet";
import { MCP_CLIENTS, type TMCPClientKey, buildClientConfigs } from "./helpers";

type Props = {
  endpoint: string;
  token: string | undefined;
};

export function MCPClientSetup(props: Props) {
  const { endpoint, token } = props;
  // states
  const [activeClient, setActiveClient] = useState<TMCPClientKey>("claude-code");
  // translation
  const { t } = useTranslation();
  const { isMobile } = usePlatformOS();
  // derived values
  const configs = buildClientConfigs(endpoint, token);

  return (
    <section>
      <h4 className="text-14 font-medium text-primary">{t("account_settings.mcp.clients.title")}</h4>
      <p className="mt-1 text-13 text-tertiary">{t("account_settings.mcp.clients.description")}</p>
      <Tabs className="mt-3" value={activeClient} onValueChange={(value) => setActiveClient(value as TMCPClientKey)}>
        <Tabs.List className="w-fit">
          {MCP_CLIENTS.map((client) => (
            <Tabs.Trigger key={client} value={client} size="md">
              {t(`account_settings.mcp.clients.${client}.name`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {MCP_CLIENTS.map((client) => {
          const config = configs[client];
          return (
            <Tabs.Content key={client} value={client} className="pt-4">
              <p className="text-13 text-tertiary">{t(`account_settings.mcp.clients.${client}.help`)}</p>
              {config.deepLink !== undefined || client === "cursor" || client === "vscode" ? (
                <Tooltip
                  tooltipContent={t("account_settings.mcp.clients.needs_token")}
                  disabled={!!config.deepLink}
                  isMobile={isMobile}
                >
                  <span className="mt-3 inline-block">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!config.deepLink}
                      onClick={() => config.deepLink && window.open(config.deepLink, "_self")}
                    >
                      {t(`account_settings.mcp.clients.${client}.install`)}
                    </Button>
                  </span>
                </Tooltip>
              ) : null}
              {config.command && <CopyableSnippet className="mt-3" value={config.command} />}
              {config.json && <CopyableSnippet className="mt-3" value={config.json} label={config.file} />}
            </Tabs.Content>
          );
        })}
      </Tabs>
    </section>
  );
}
