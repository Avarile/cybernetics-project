/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";
import { WORDMARK_HEIGHT, WORDMARK_PATH, WORDMARK_VIEW_BOX, WORDMARK_WIDTH } from "./cybernetics-wordmark-path";

/**
 * "Cybernetics" outlined from Space Grotesk SemiBold. The glyphs are real paths,
 * not an SVG <text> element, so the wordmark cannot shift or fall back to another
 * face depending on what fonts happen to be loaded.
 */
export function CyberneticsWordmark({ width, height = 24, className, ...rest }: ISvgIcons) {
  return (
    <svg
      width={width ?? undefined}
      height={height}
      viewBox={WORDMARK_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Cybernetics"
      {...rest}
    >
      <path d={WORDMARK_PATH} fill="currentColor" />
    </svg>
  );
}

export { WORDMARK_HEIGHT, WORDMARK_WIDTH };
