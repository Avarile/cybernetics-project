/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";
import { BRAND_ACCENT, BRAND_CREAM } from "./tokens";

/**
 * The plated app icon — bronze tile, cream glyph. Unlike {@link CyberneticsMark}
 * this is a fixed-color lockup: it stands in for the installed app, so it must
 * look the same everywhere rather than inheriting the surrounding text color.
 */
export function CyberneticsAppIcon({ width = 32, height = 32, className, ...rest }: ISvgIcons) {
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
      <rect width="32" height="32" rx="6.6" fill={BRAND_ACCENT} />
      <rect x="7.6" y="7.6" width="3.4" height="16.8" fill={BRAND_CREAM} />
      <rect x="13.4" y="8.6" width="8" height="3.4" fill={BRAND_CREAM} />
      <rect x="13.4" y="14.3" width="11" height="3.4" fill={BRAND_CREAM} />
      <rect x="13.4" y="20" width="5.6" height="3.4" fill={BRAND_CREAM} />
    </svg>
  );
}
