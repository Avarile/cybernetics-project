/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Bot } from "lucide-react";
import { EUserPermissionsLevel, EUserPermissions } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Breadcrumbs, Header } from "@plane/ui";
// components
import { CreateAgentModal } from "@/components/agents/create-agent-modal";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
// hooks
import { useAgent } from "@/hooks/store/use-agent";
import { useUserPermissions } from "@/hooks/store/user";

export const WorkspaceAgentsHeader = observer(function WorkspaceAgentsHeader() {
  const { workspaceSlug, agentId } = useParams();
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();
  const { getAgentById } = useAgent();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const slug = workspaceSlug?.toString() ?? "";
  const agent = agentId ? getAgentById(agentId.toString()) : undefined;
  const canCreate = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, slug);

  return (
    <>
      <Header>
        <Header.LeftItem>
          <Breadcrumbs>
            <Breadcrumbs.Item
              component={
                <BreadcrumbLink
                  label={t("sidebar.agents")}
                  href={agentId ? `/${slug}/agents` : undefined}
                  icon={<Bot className="size-4 text-secondary" />}
                />
              }
            />
            {agent && <Breadcrumbs.Item component={<BreadcrumbLink label={agent.name} />} />}
          </Breadcrumbs>
        </Header.LeftItem>
        {canCreate && !agentId && (
          <Header.RightItem>
            <Button variant="primary" size="lg" onClick={() => setIsCreateOpen(true)}>
              {t("agents.create.button")}
            </Button>
          </Header.RightItem>
        )}
      </Header>
      <CreateAgentModal workspaceSlug={slug} isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </>
  );
});
