/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Regenerates the outlined "Cybernetics" wordmark used by the brand components.
 *
 * The wordmark ships as SVG path data rather than an SVG <text> element so it
 * renders identically everywhere without Space Grotesk being installed at
 * runtime. @fontsource/space-grotesk is a devDependency purely as the outlining
 * source — nothing here ends up in the runtime bundle.
 *
 * Run with: pnpm --filter @plane/propel exec node scripts/generate-brand-wordmark.mjs
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { outlineText } from "./lib/outline-text.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../src/icons/brand/cybernetics-wordmark-path.ts");

const TEXT = "Cybernetics";
/** -0.02em, matching the Brand Hub's display tracking. */
const TRACKING_EM = -0.02;
const WEIGHT = 600;

/** Cap height the wordmark is scaled to inside the 32-unit lockup viewBox. */
const LOCKUP_CAP_HEIGHT = 16;
/** Left edge of the wordmark in the lockup: mark spans 0..29.2, plus a 4.8-unit gap. */
const LOCKUP_WORDMARK_X = 34;
/** The lockup centres the wordmark's cap height on the mark's centre line. */
const LOCKUP_CAP_TOP = 16 - LOCKUP_CAP_HEIGHT / 2;

const {
  d: path,
  width,
  height,
  capOvershoot,
  unitsPerEm,
  capHeight,
} = outlineText({
  text: TEXT,
  weight: WEIGHT,
  trackingEm: TRACKING_EM,
});

const scale = LOCKUP_CAP_HEIGHT / capHeight;
const round = (n) => +n.toFixed(4);

const file = `/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/*
 * GENERATED FILE — do not edit by hand.
 * Regenerate with: pnpm --filter @plane/propel exec node scripts/generate-brand-wordmark.mjs
 *
 * "${TEXT}" outlined from Space Grotesk SemiBold at ${TRACKING_EM}em tracking.
 * Coordinates are in font units (${unitsPerEm}/em), origin at the ink's top-left.
 */

/** Tight bounding box of the outlined wordmark. */
export const WORDMARK_VIEW_BOX = "0 0 ${width} ${height}";
export const WORDMARK_WIDTH = ${width};
export const WORDMARK_HEIGHT = ${height};

/** Outlined "${TEXT}". Fill it, never stroke it. */
export const WORDMARK_PATH =
  "${path}";

/**
 * Places the wordmark inside the 32-unit lockup viewBox, with its cap height
 * scaled to ${LOCKUP_CAP_HEIGHT} units and centred on the mark's centre line.
 */
export const LOCKUP_WORDMARK_TRANSFORM = "translate(${LOCKUP_WORDMARK_X} ${round(LOCKUP_CAP_TOP - capOvershoot * scale)}) scale(${round(scale)})";

/** Total width of the mark + gap + wordmark lockup, at a height of 32. */
export const LOCKUP_WIDTH = ${Math.round(LOCKUP_WORDMARK_X + width * scale)};
`;

writeFileSync(OUT, file);
console.log(`wordmark: ${width}x${height} font units, ${path.length} chars of path data`);
console.log(`lockup:   ${Math.round(LOCKUP_WORDMARK_X + width * scale)}x32, scale ${round(scale)}`);
console.log(`wrote     ${OUT}`);
