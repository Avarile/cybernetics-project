/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { EUserPermissionsLevel, EUserPermissions } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// hooks
import { useUserPermissions } from "@/hooks/store/user";

/** Agents are visible to workspace admins and members; guests see a notice instead. */
export const AgentsAccessGuard = observer(function AgentsAccessGuard({ children }: { children: ReactNode }) {
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();
  const allowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE,
    workspaceSlug?.toString()
  );
  if (!allowed) return <p className="p-6 text-13 text-tertiary">{t("agents.detail.no_access")}</p>;
  return <>{children}</>;
});
