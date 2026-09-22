/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { ProfileSettingsHeading } from "@/components/settings/profile/heading";
// local imports
import { MCPClientSetup } from "./client-setup";
import { MCPEndpointCard } from "./endpoint-card";
import { buildEndpointUrl } from "./helpers";
import { MCPTokenStep } from "./token-step";
import { MCPToolCatalog } from "./tool-catalog";

export function MCPProfileSettings() {
  // The token is only ever held in memory: it is shown once on creation and
  // must not be persisted anywhere in the client.
  const [token, setToken] = useState<string | undefined>(undefined);
  // translation
  const { t } = useTranslation();
  // derived values
  const endpoint = buildEndpointUrl();

  return (
    <div className="size-full">
      <ProfileSettingsHeading
        title={t("account_settings.mcp.title")}
        description={t("account_settings.mcp.description")}
      />
      <div className="mt-7 space-y-8">
        <MCPEndpointCard endpoint={endpoint} token={token} />
        <MCPTokenStep token={token} onTokenChange={setToken} />
        <MCPClientSetup endpoint={endpoint} token={token} />
        <MCPToolCatalog />
      </div>
    </div>
  );
}
