/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

/**
 * Rendered sizes. The mark's rungs stop resolving below 20px, so `sm` is the
 * floor — see `CyberneticsMark`'s compact threshold.
 */
const SIZES = { sm: 20, md: 28, lg: 44 } as const;

export type TCyberneticsLoaderSize = keyof typeof SIZES;

type TCyberneticsLoaderProps = {
  /** `lg` for full-page waits, `md` for panels and inline regions. Defaults to `lg`. */
  size?: TCyberneticsLoaderSize;
  className?: string;
  /** Announced by screen readers while the region is busy. */
  label?: string;
};

/** Staggered so the rungs fill top-to-bottom, matching the brand loader's cascade. */
const RUNG_DELAYS = ["0ms", "160ms", "320ms"];

/**
 * The brand loading animation: the feedback loop rotates once every 1.6s while
 * the task-list rungs cascade in opacity.
 *
 * Drawn rather than played back from a GIF, which means it stays crisp at any
 * size, follows `currentColor` into every theme, and can hold still under
 * `prefers-reduced-motion`.
 */
export function CyberneticsLoader({ size = "lg", className, label = "Loading" }: TCyberneticsLoaderProps) {
  const px = SIZES[size];

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="status"
      aria-label={label}
    >
      <circle
        cx="16"
        cy="16"
        r="12"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeDasharray="58 18"
        className="animate-brand-loop-spin motion-reduce:animate-none"
        /* Pinned explicitly: Safari has been unreliable about defaulting SVG `transform-box` to `view-box`. */
        style={{ transformBox: "view-box", transformOrigin: "center" }}
      />
      <rect x="10.4" y="9.2" width="2.2" height="13.6" fill="currentColor" />
      {[
        { x: 14.4, y: 10.4, width: 6.4 },
        { x: 14.4, y: 14.9, width: 9 },
        { x: 14.4, y: 19.4, width: 4.2 },
      ].map((rung, index) => (
        <rect
          key={rung.y}
          x={rung.x}
          y={rung.y}
          width={rung.width}
          height="2.2"
          fill="currentColor"
          className="animate-brand-loop-pulse motion-reduce:animate-none"
          style={{ animationDelay: RUNG_DELAYS[index] }}
        />
      ))}
    </svg>
  );
}
