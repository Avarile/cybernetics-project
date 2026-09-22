/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Link } from "react-router";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Input } from "@plane/propel/input";
// components
import { CreateApiTokenModal } from "@/components/api-token/modal/create-token-modal";

type Props = {
  token: string | undefined;
  onTokenChange: (token: string | undefined) => void;
};

export function MCPTokenStep(props: Props) {
  const { token, onTokenChange } = props;
  // states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPasting, setIsPasting] = useState(false);
  // translation
  const { t } = useTranslation();

  return (
    <section>
      <CreateApiTokenModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onGenerated={(generated) => onTokenChange(generated.token ?? undefined)}
      />
      <h4 className="text-14 font-medium text-primary">{t("account_settings.mcp.token.title")}</h4>
      <p className="mt-1 text-13 text-tertiary">{t("account_settings.mcp.token.description")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" onClick={() => setIsModalOpen(true)}>
          {t("account_settings.mcp.token.generate")}
        </Button>
        {!isPasting && !token && (
          <Button variant="link" size="sm" onClick={() => setIsPasting(true)}>
            {t("account_settings.mcp.token.use_existing")}
          </Button>
        )}
        {token && (
          <>
            <span className="text-13 text-success-primary">{t("account_settings.mcp.token.ready")}</span>
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                onTokenChange(undefined);
                setIsPasting(false);
              }}
            >
              {t("account_settings.mcp.token.clear")}
            </Button>
          </>
        )}
      </div>
      {isPasting && !token && (
        <Input
          type="password"
          autoComplete="off"
          className="mt-3 w-full"
          placeholder={t("account_settings.mcp.token.paste_placeholder")}
          onChange={(e) => onTokenChange(e.target.value.trim() || undefined)}
        />
      )}
      <p className="mt-3 text-11 text-placeholder">
        {t("account_settings.mcp.token.revoke_hint")}{" "}
        <Link to="/settings/profile/api-tokens" className="text-accent-primary hover:underline">
          {t("profile.actions.api-tokens")}
        </Link>
        .
      </p>
    </section>
  );
}
