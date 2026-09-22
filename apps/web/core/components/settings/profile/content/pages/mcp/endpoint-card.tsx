/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
// plane imports
import { MCP_TOOLS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Badge } from "@plane/propel/badge";
import { Button } from "@plane/propel/button";
// local imports
import { CopyableSnippet } from "./copyable-snippet";
import { type TMCPConnectionResult, isSameOriginEndpoint, testMCPConnection } from "./helpers";

type Props = {
  endpoint: string;
  token: string | undefined;
};

export function MCPEndpointCard(props: Props) {
  const { endpoint, token } = props;
  // states
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<TMCPConnectionResult | null>(null);
  // translation
  const { t } = useTranslation();
  // derived values
  const canProbe = isSameOriginEndpoint(endpoint);

  const handleTest = async () => {
    if (!token) return;
    setIsTesting(true);
    setResult(await testMCPConnection(endpoint, token));
    setIsTesting(false);
  };

  return (
    <section className="rounded-lg border-[0.5px] border-subtle p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-14 font-medium text-primary">{t("account_settings.mcp.endpoint.title")}</h4>
        <Badge variant="neutral">{t("account_settings.mcp.endpoint.transport")}</Badge>
        <Badge variant="neutral">{t("account_settings.mcp.endpoint.stateless")}</Badge>
        <Badge variant="brand">{t("account_settings.mcp.tools.count", { count: MCP_TOOLS.length })}</Badge>
      </div>
      <CopyableSnippet className="mt-3" value={endpoint} />
      <p className="mt-2 text-11 text-placeholder">{t("account_settings.mcp.endpoint.hint")}</p>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={handleTest} disabled={!token || isTesting || !canProbe}>
          {isTesting ? t("account_settings.mcp.endpoint.testing") : t("account_settings.mcp.endpoint.test")}
        </Button>
        {!canProbe && <p className="text-11 text-placeholder">{t("account_settings.mcp.endpoint.cross_origin")}</p>}
        {canProbe && !token && (
          <p className="text-11 text-placeholder">{t("account_settings.mcp.endpoint.needs_token")}</p>
        )}
        {result && (
          <p className={result.status === "connected" ? "text-11 text-success-primary" : "text-11 text-danger-primary"}>
            {result.status === "connected"
              ? t("account_settings.mcp.endpoint.connected", { count: result.toolCount })
              : t(`account_settings.mcp.endpoint.${result.status}`)}
          </p>
        )}
      </div>
    </section>
  );
}
