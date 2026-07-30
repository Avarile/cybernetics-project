/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";

export function PyberneticsWordmark({ width = "185", height = "32", className, color = "currentColor" }: ISvgIcons) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 185 32"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/*
        NOTE: This wordmark uses a live <text> element for speed of iteration.
        Before shipping, convert this to outlined paths (e.g. via a font
        outliner or the design tool) so it renders consistently without
        depending on the font being installed/loaded at runtime.
      */}
      <text
        x="0"
        y="24"
        fontFamily="'Space Grotesk', 'Inter', -apple-system, sans-serif"
        fontSize="26"
        fontWeight="600"
        letterSpacing="-0.5"
        fill={color}
      >
        Cybernetics
      </text>
    </svg>
  );
}
