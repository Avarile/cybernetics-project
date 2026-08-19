/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Converts a string into SVG path data using Space Grotesk, the brand display
 * face. Shared by the wordmark and the OG-image generators.
 *
 * We outline rather than emitting <text> so brand artwork renders identically
 * wherever it lands — a Storybook chrome, an e-mail client, a social-card
 * scraper — none of which can be relied on to have the font.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit");

const OPS = { moveTo: "M", lineTo: "L", quadraticCurveTo: "Q", bezierCurveTo: "C", closePath: "Z" };

/**
 * fontkit cannot apply variable-font deltas to a WOFF2 (its bundled build is
 * missing `_getPhantomPoints`), so we always load a static per-weight instance.
 */
const loadFont = (weight) =>
  fontkit.openSync(require.resolve(`@fontsource/space-grotesk/files/space-grotesk-latin-${weight}-normal.woff2`));

/**
 * @param {{ text: string, weight?: 300|400|500|600|700, trackingEm?: number }} options
 * @returns path data normalised to a tight box with the origin at the ink's
 *   top-left, in font units, already flipped into SVG's Y-down space.
 */
export function outlineText({ text, weight = 600, trackingEm = -0.02 }) {
  const font = loadFont(weight);
  if (Object.keys(font.variationAxes ?? {}).length > 0) {
    throw new Error(`Expected a static instance for weight ${weight}, got a variable font.`);
  }

  const tracking = trackingEm * font.unitsPerEm;
  const run = font.layout(text);

  const commands = [];
  let pen = 0;
  run.glyphs.forEach((glyph, index) => {
    commands.push(...glyph.path.translate(pen, 0).commands);
    pen += run.positions[index].xAdvance + tracking;
  });

  const ink = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const command of commands) {
    for (let i = 0; i < command.args.length; i += 2) {
      ink.minX = Math.min(ink.minX, command.args[i]);
      ink.maxX = Math.max(ink.maxX, command.args[i]);
      ink.minY = Math.min(ink.minY, command.args[i + 1]);
      ink.maxY = Math.max(ink.maxY, command.args[i + 1]);
    }
  }

  const toX = (v) => Math.round(v - ink.minX);
  const toY = (v) => Math.round(ink.maxY - v);

  let d = "";
  for (const command of commands) {
    const points = [];
    for (let i = 0; i < command.args.length; i += 2) {
      points.push(`${toX(command.args[i])} ${toY(command.args[i + 1])}`);
    }
    d += OPS[command.command] + points.join(" ");
  }

  return {
    d,
    width: Math.round(ink.maxX - ink.minX),
    height: Math.round(ink.maxY - ink.minY),
    /** Ink rises above the cap line on round glyphs; needed to align by cap height. */
    capOvershoot: toY(font.capHeight),
    unitsPerEm: font.unitsPerEm,
    capHeight: font.capHeight,
  };
}
