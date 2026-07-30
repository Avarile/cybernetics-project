/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";

export function PlaneLogo({ width = "128", height = "78", className, color = "currentColor" }: ISvgIcons) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 52 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Stem of the "P" */}
      <rect x="9" y="9" width="6" height="24" rx="3" fill={color} />
      {/* Feedback loop forming the bowl of the "P" */}
      <circle
        cx="22"
        cy="17"
        r="9"
        stroke={color}
        strokeWidth="6"
        fill="none"
        strokeDasharray="44 13"
        strokeDashoffset="-8"
        strokeLinecap="round"
      />
      {/* Arrowhead closing the loop */}
      <path d="M29.5 23L34.5 26.5L29.5 29.5V23Z" fill={color} />
    </svg>
  );
}
