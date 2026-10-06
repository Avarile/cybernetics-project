/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Bot } from "lucide-react";
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
