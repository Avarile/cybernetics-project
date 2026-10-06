/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
// components
import { AgentsList } from "@/components/agents/agents-list";
import { PageHead } from "@/components/core/page-title";
import { AgentsAccessGuard } from "./access-guard";

function WorkspaceAgentsPage() {
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  return (
    <AgentsAccessGuard>
      <PageHead title={t("sidebar.agents")} />
      <div className="relative h-full w-full overflow-hidden overflow-y-auto">
        <AgentsList workspaceSlug={workspaceSlug?.toString() ?? ""} />
      </div>
    </AgentsAccessGuard>
  );
}

export default observer(WorkspaceAgentsPage);
