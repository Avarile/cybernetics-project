/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";

/**
 * Below this rendered size the full mark's 2.2-unit rungs fall under a pixel
 * and smear into each other, so the compact geometry takes over.
 */
const COMPACT_THRESHOLD = 20;

export type TCyberneticsMarkVariant = "full" | "compact";

type TCyberneticsMarkProps = ISvgIcons & {
  /**
   * `full` is the brand mark as drawn. `compact` thickens the strokes and drops
   * the shortest rung so the glyph still reads below {@link COMPACT_THRESHOLD}px.
   * Defaults to `compact` when a numeric `height`/`width` says the mark is small,
   * otherwise `full` — pass it explicitly when the size comes from CSS.
   */
  variant?: TCyberneticsMarkVariant;
};

const resolveVariant = (
  variant: TCyberneticsMarkVariant | undefined,
  height: ISvgIcons["height"],
  width: ISvgIcons["width"]
): TCyberneticsMarkVariant => {
  if (variant) return variant;
  const size = Number(height ?? width);
  return Number.isFinite(size) && size > 0 && size < COMPACT_THRESHOLD ? "compact" : "full";
};

/**
 * The Cybernetics Project mark: an open feedback loop around a task-list glyph.
 * Inherits `currentColor`, so it recolors with the surrounding text.
 */
export function CyberneticsMark({ width = 32, height = 32, className, variant, ...rest }: TCyberneticsMarkProps) {
  const resolved = resolveVariant(variant, height, width);

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...rest}
    >
      {resolved === "full" ? (
        <>
          {/* Open feedback loop */}
          <circle
            cx="16"
            cy="16"
            r="12"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeDasharray="58 18"
            transform="rotate(-58 16 16)"
          />
          {/* Task-list glyph: stem plus three rungs */}
          <rect x="10.4" y="9.2" width="2.2" height="13.6" fill="currentColor" />
          <rect x="14.4" y="10.4" width="6.4" height="2.2" fill="currentColor" />
          <rect x="14.4" y="14.9" width="9" height="2.2" fill="currentColor" />
          <rect x="14.4" y="19.4" width="4.2" height="2.2" fill="currentColor" />
        </>
      ) : (
        <>
          <circle
            cx="16"
            cy="16"
            r="11.6"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeDasharray="56 17"
            transform="rotate(-58 16 16)"
          />
          <rect x="10" y="9" width="3.2" height="14" fill="currentColor" />
          <rect x="15.2" y="10.4" width="7" height="3.2" fill="currentColor" />
          <rect x="15.2" y="18.4" width="9.4" height="3.2" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
