/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Fixed brand colors, for the places a mark must not inherit its surroundings:
 * plated app icons, favicons, e-mail artwork, OG images.
 *
 * Everywhere inside the product, prefer `currentColor` (see `CyberneticsMark`)
 * or the `--brand-*` tokens in `@plane/tailwind-config`, which are tuned per
 * theme. These constants are the flat, theme-less source values.
 */

/** Cybernetics Project accent — bronze. */
export const BRAND_ACCENT = "#B4763A";

/** Brand ink, used for the parent-brand mark and dark plates. */
export const BRAND_INK = "#0E1116";

/** Brand cream, used for glyphs knocked out of a colored plate. */
export const BRAND_CREAM = "#F4F2EC";
