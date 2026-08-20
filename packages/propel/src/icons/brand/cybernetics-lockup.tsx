/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";
import { LOCKUP_WIDTH as WORDMARK_LOCKUP_WIDTH, LOCKUP_WORDMARK_TRANSFORM } from "./cybernetics-wordmark-path";

/**
 * The wordmark, split so the name and the qualifier can carry different fills.
 * The qualifier's leading space is a non-breaking one: SVG collapses ordinary
 * leading whitespace inside a `<tspan>`, which would butt it against the name.
 */
const WORDMARK_NAME = "Cybernetics";
const WORDMARK_QUALIFIER = " - project";

/** Accessible name — the two spans read as one string. */
const WORDMARK_TEXT = "Cybernetics - project";

/** The name is knocked out in white; the qualifier stays on `currentColor`. */
const WORDMARK_NAME_FILL = "#FFFFFF";

/**
 * {@link LOCKUP_WORDMARK_TRANSFORM} puts us in the wordmark's own coordinate
 * space — 1000 font units per em — so the size below is in font units, not
 * lockup units. At 700 the cap height lands at 11.2 of the viewBox's 32.
 */
const WORDMARK_FONT_SIZE = 700;

/** Space Grotesk's cap height, as a fraction of the em. */
const CAP_HEIGHT_RATIO = 0.7;

/**
 * The scale and y-offset baked into {@link LOCKUP_WORDMARK_TRANSFORM}. Mirrored
 * here so the baseline can be derived; keep in step with the generator if the
 * wordmark is ever regenerated at a different cap height.
 */
const WORDMARK_SCALE = 0.0229;
const WORDMARK_ORIGIN_Y = 7.68;

/** The mark's centre line, which the wordmark's cap height is centred on. */
const MARK_CENTRE_Y = 16;

/**
 * Baseline in font-unit space, derived so the cap height stays centred on the
 * mark's centre line at whatever {@link WORDMARK_FONT_SIZE} is set to — 538 at
 * a 500-unit size, 608 at 700.
 */
const WORDMARK_BASELINE = Math.round(
  (MARK_CENTRE_Y + (WORDMARK_FONT_SIZE * CAP_HEIGHT_RATIO * WORDMARK_SCALE) / 2 - WORDMARK_ORIGIN_Y) / WORDMARK_SCALE
);

/** Space Grotesk is the brand display face; the rest are runtime fallbacks. */
const WORDMARK_FONT_FAMILY = "'Space Grotesk', ui-sans-serif, system-ui, sans-serif";

/** Extra breathing room between the icon plate and the wordmark, in viewBox units. */
const ICON_GAP_INCREASE = 10;

/** The icon plate occupies the full 32-unit height, like the mark it replaces. */
const ICON_SIZE = 32;

/** Corner radius of the plate, matching `CyberneticsAppIcon`. */
const ICON_RADIUS = 6.6;

/**
 * The app icon plate, inlined from `apps/web/public/favicon/maskable-192x192.png`
 * as a data URI. Embedded rather than referenced by URL so the lockup stays
 * self-contained: `apps/admin` and `apps/space` serve under their own base
 * paths, and the mark is also used outside a served document (Storybook, OG
 * artwork), where an absolute `/favicon/...` href would not resolve.
 */
const ICON_HREF = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAACXBIWXMAADsOAAA7DgHMtqGDAAACqklEQVR42u3dsUpCURjAcZ9LcFAQXMXRxckHaIjgojjpZOjgWEv0Bl0sUJBLS3QfoNHRIRqk/YiNIUK3Er3+hv984fD9hgPf4RYeLotBOtcKDkEASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAEgASABIAAgAhyAAJAAkAHLWfNAI6X0nc8moZVAAON22Q/y5fs/c2+zWoAAAgAAAQAAAIAAA2H3h7tfDMo2PrmTsIg/AAQAsrpu/+tZ/9XJzYdgBAEAAACAAABAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANjXNKqE50n76Hrq1Qw7AF6ECQAABAAAAgAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP94FGjbD+mOVm17vIgAAOP1luKxtzw4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwDq0dWgAPIgRAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAP8nbW3xVMsAAnO8y3GO3aoABAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAADwVwDm/XpYpvFBmkZlAwyAF2ECAAABAIAAAEAAfLuYDhpfCLKWjFoGBQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAHgEASABIAEgASABIAEgASABIAEgASABICUizZNAwxcD/a6lwAAAABJRU5ErkJggg==";

/** Total lockup width, including the widened icon gap. */
export const LOCKUP_WIDTH = WORDMARK_LOCKUP_WIDTH + ICON_GAP_INCREASE;

/**
 * Horizontal lockup: the app icon plate, then the wordmark with its cap height
 * centred on the plate's centre line. The plate is a raster with baked-in brand
 * colours, so only the qualifier still follows `currentColor` — the name is
 * pinned to white.
 */
export function CyberneticsLockup({ width, height = 32, className, ...rest }: ISvgIcons) {
  const clipId = React.useId();

  return (
    <svg
      width={width ?? undefined}
      height={height}
      viewBox={`0 0 ${LOCKUP_WIDTH} 32`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={WORDMARK_TEXT}
      {...rest}
    >
      {/* Icon — the maskable app-icon plate; rounded here because a maskable asset ships unmasked. */}
      <defs>
        <clipPath id={clipId}>
          <rect width={ICON_SIZE} height={ICON_SIZE} rx={ICON_RADIUS} />
        </clipPath>
      </defs>
      <image href={ICON_HREF} x="0" y="0" width={ICON_SIZE} height={ICON_SIZE} clipPath={`url(#${clipId})`} />
      {/* Wordmark */}
      <g transform={`translate(${ICON_GAP_INCREASE} 0) ${LOCKUP_WORDMARK_TRANSFORM}`}>
        <text
          x="0"
          y={WORDMARK_BASELINE}
          fill="currentColor"
          fontFamily={WORDMARK_FONT_FAMILY}
          fontSize={WORDMARK_FONT_SIZE}
          fontWeight={600}
          letterSpacing="-0.02em"
        >
          <tspan fill={WORDMARK_NAME_FILL}>{WORDMARK_NAME}</tspan>
          <tspan>{WORDMARK_QUALIFIER}</tspan>
        </text>
      </g>
    </svg>
  );
}
