/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import type { LucideIcon } from "lucide-react";
import { MembersPropertyIcon } from "@plane/propel/icons";
// plane ui
import { Avatar, AvatarGroup } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
// plane utils
// helpers
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useAgent } from "@/hooks/store/use-agent";
// components
import { AgentMemberAvatar } from "@/components/agents/agent-avatar";

type AvatarProps = {
  showTooltip: boolean;
  userIds: string | string[] | null;
  icon?: LucideIcon;
  size?: "sm" | "md" | "base" | "lg" | number;
};

export const ButtonAvatars = observer(function ButtonAvatars(props: AvatarProps) {
  const { showTooltip, userIds, icon: Icon, size = "md" } = props;
  // store hooks
  const { getUserDetails } = useMember();
  const { getAgentByBotUserId } = useAgent();

  // Agents show a bot icon (or their emoji) instead of the initial-letter avatar
  const renderAvatar = (userId: string, extraProps?: { size?: AvatarProps["size"]; showTooltip?: boolean }) => {
    const userDetails = getUserDetails(userId);
    const agent = getAgentByBotUserId(userId);
    if (agent || (userDetails?.is_bot && userDetails.bot_type === "AGENT"))
      return (
        <AgentMemberAvatar
          key={userId}
          name={agent?.name ?? userDetails?.display_name ?? ""}
          {...(extraProps as object)}
        />
      );
    return (
      <Avatar
        key={userId}
        src={getFileURL(userDetails?.avatar_url ?? "")}
        name={userDetails?.display_name}
        {...(extraProps as object)}
      />
    );
  };

  if (Array.isArray(userIds)) {
    if (userIds.length > 0)
      return (
        <AvatarGroup size={size} showTooltip={!showTooltip}>
          {userIds.map((userId) => {
            if (!getUserDetails(userId)) return;
            return renderAvatar(userId);
          })}
        </AvatarGroup>
      );
  } else {
    if (userIds) {
      return renderAvatar(userIds, { size, showTooltip: !showTooltip });
    }
  }

  return Icon ? (
    <Icon className="h-3 w-3 flex-shrink-0" />
  ) : (
    <MembersPropertyIcon className={cn("mx-[4px] h-3 w-3 flex-shrink-0")} />
  );
});
