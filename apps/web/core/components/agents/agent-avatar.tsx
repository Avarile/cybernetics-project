/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Bot, Settings } from "lucide-react";
import { Tooltip } from "@plane/propel/tooltip";
import type { TAgentLogoProps } from "@plane/types";
import { cn } from "@plane/utils";

type Props = {
  name: string;
  logoProps?: TAgentLogoProps;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZES = {
  sm: { box: "size-5 text-11", icon: "size-3" },
  md: { box: "size-8 text-14", icon: "size-4" },
  lg: { box: "size-12 text-20", icon: "size-6" },
};

/** Square avatar for an agent: its emoji (stored literally in ``logo_props.emoji.value``) or a bot glyph. */
export function AgentAvatar({ name, logoProps, size = "md", className }: Props) {
  const emoji = logoProps?.in_use === "emoji" ? logoProps.emoji?.value : undefined;
  const styles = SIZES[size];
  return (
    <span
      aria-label={name}
      className={cn(
        "grid flex-shrink-0 place-items-center rounded-md bg-accent-subtle text-accent-primary",
        styles.box,
        className
      )}
    >
      {emoji ? emoji : <Bot className={styles.icon} />}
    </span>
  );
}

const MEMBER_AVATAR_SIZES = {
  sm: "size-4",
  md: "size-5",
  base: "size-6",
  lg: "size-7",
};

type MemberAvatarProps = {
  name: string;
  /** Same size scale as `Avatar` from `@plane/ui`; `AvatarGroup` injects `size` and `showTooltip`. */
  size?: keyof typeof MEMBER_AVATAR_SIZES | number;
  showTooltip?: boolean;
};

/**
 * Agent marker that takes the place of an `Avatar` (initial letter) wherever members are shown:
 * a slowly turning gear (static when the user prefers reduced motion).
 */
export function AgentMemberAvatar({ name, size = "md", showTooltip = true }: MemberAvatarProps) {
  return (
    <Tooltip tooltipContent={name} disabled={!showTooltip}>
      <span
        aria-label={name}
        className={cn(
          "relative grid flex-shrink-0 place-items-center text-(--extended-color-crimson-500)",
          typeof size === "number" ? undefined : MEMBER_AVATAR_SIZES[size]
        )}
        style={typeof size === "number" ? { width: size, height: size } : undefined}
        tabIndex={-1}
      >
        <Settings
          className="size-full motion-safe:animate-spin"
          strokeWidth={2.5}
          style={{ animationDuration: "8s" }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1 -right-1.5 text-9 leading-none font-bold lowercase"
        >
          ai
        </span>
      </span>
    </Tooltip>
  );
}

/** Small "Agent" marker shown next to an agent's name or avatar. */
export function AgentBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm bg-accent-subtle px-1 text-11 font-medium text-accent-primary",
        className
      )}
    >
      <Bot className="size-3" />
      {label}
    </span>
  );
}
