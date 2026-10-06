/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { AgentDetailRoot } from "@/components/agents/detail/agent-detail-root";
import { PageHead } from "@/components/core/page-title";
// hooks
import { useAgent } from "@/hooks/store/use-agent";
import { AgentsAccessGuard } from "../access-guard";

function WorkspaceAgentDetailPage() {
  const { workspaceSlug, agentId, tab } = useParams();
  const { getAgentById } = useAgent();
  const agent = agentId ? getAgentById(agentId.toString()) : undefined;
  return (
    <AgentsAccessGuard>
      <PageHead title={agent?.name} />
      <div className="relative h-full w-full overflow-hidden overflow-y-auto">
        <AgentDetailRoot
          workspaceSlug={workspaceSlug?.toString() ?? ""}
          agentId={agentId?.toString() ?? ""}
          tab={tab?.toString()}
        />
      </div>
    </AgentsAccessGuard>
  );
}

export default observer(WorkspaceAgentDetailPage);
