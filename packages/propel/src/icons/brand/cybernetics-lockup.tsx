/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";
import { LOCKUP_WIDTH, LOCKUP_WORDMARK_TRANSFORM, WORDMARK_PATH } from "./cybernetics-wordmark-path";

/**
 * Horizontal lockup: the mark, then the outlined wordmark with its cap height
 * centred on the mark's centre line. Inherits `currentColor` throughout, so a
 * single component covers the ink, cream and accent treatments.
 */
export function CyberneticsLockup({ width, height = 32, className, ...rest }: ISvgIcons) {
  return (
    <svg
      width={width ?? undefined}
      height={height}
      viewBox={`0 0 ${LOCKUP_WIDTH} 32`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Cybernetics"
      {...rest}
    >
      {/* Mark — kept at the full geometry; the lockup is never rendered small enough to need the compact one. */}
      <circle
        cx="16"
        cy="16"
        r="12"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeDasharray="58 18"
        transform="rotate(-58 16 16)"
      />
      <rect x="10.4" y="9.2" width="2.2" height="13.6" fill="currentColor" />
      <rect x="14.4" y="10.4" width="6.4" height="2.2" fill="currentColor" />
      <rect x="14.4" y="14.9" width="9" height="2.2" fill="currentColor" />
      <rect x="14.4" y="19.4" width="4.2" height="2.2" fill="currentColor" />
      {/* Wordmark */}
      <g transform={LOCKUP_WORDMARK_TRANSFORM}>
        <path d={WORDMARK_PATH} fill="currentColor" />
      </g>
    </svg>
  );
}

export { LOCKUP_WIDTH };
