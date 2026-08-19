/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Rasterizes every favicon, PWA icon and e-mail lockup from the vendored brand
 * SVGs in ../assets/brand, into an identical set for web, space and admin.
 *
 * Each app used to keep its own hand-managed copies, which is how web ended up a
 * rebrand ahead of the other two. Regenerate instead of editing the outputs:
 *   pnpm --filter @plane/propel exec node scripts/generate-brand-icons.mjs
 */

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { outlineText } from "./lib/outline-text.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const INK = "#0E1116";
const CREAM = "#F4F2EC";
const ACCENT = "#B4763A";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAND = resolve(HERE, "../assets/brand");
const REPO = resolve(HERE, "../../..");

const APPS = ["web", "space", "admin"];

/** Bundled with the app and imported through Vite's `?url`. */
const ASSET_DIR = (app) => resolve(REPO, `apps/${app}/app/assets/favicon`);
/** Served from the web root at a stable path, for the manifest to point at. */
const PUBLIC_DIR = (app) => resolve(REPO, `apps/${app}/public/favicon`);

const svg = (name) => readFileSync(resolve(BRAND, name));

/** Bundled favicon set: plate icon at the sizes browsers actually ask for. */
const ASSET_PNGS = [
  { file: "favicon-16x16.png", size: 16, source: "app-icon.svg" },
  { file: "favicon-32x32.png", size: 32, source: "app-icon.svg" },
  { file: "favicon-96x96.png", size: 96, source: "app-icon.svg" },
  { file: "apple-touch-icon.png", size: 180, source: "app-icon.svg" },
  { file: "icon-512x512.png", size: 512, source: "app-icon.svg" },
];

/** Public set: what the manifest references, including the maskable variants. */
const PUBLIC_PNGS = [
  { file: "android-chrome-192x192.png", size: 192, source: "app-icon.svg" },
  { file: "android-chrome-512x512.png", size: 512, source: "app-icon.svg" },
  { file: "maskable-192x192.png", size: 192, source: "maskable.svg" },
  { file: "maskable-512x512.png", size: 512, source: "maskable.svg" },
];

/** Sizes packed into favicon.ico, matching what the old file carried. */
const ICO_SIZES = [16, 32, 48];

const render = (source, size) =>
  sharp(svg(source), { density: 384 }).resize(size, size, { fit: "contain" }).png({ compressionLevel: 9 }).toBuffer();

/**
 * Builds an .ico containing PNG-compressed entries. Every target browser has
 * supported PNG-in-ICO since IE6, and it keeps the file a fraction of the size
 * of the equivalent BMP payloads.
 */
const buildIco = (entries) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;

  entries.forEach(({ size, data }, index) => {
    const at = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at); // width (0 means 256)
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1); // height
    directory.writeUInt8(0, at + 2); // palette size
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
};

/** Reads the generated wordmark constants so the lockups cannot drift from the components. */
const readLockupGeometry = () => {
  const source = readFileSync(resolve(HERE, "../src/icons/brand/cybernetics-wordmark-path.ts"), "utf8");
  const pick = (pattern, label) => {
    const match = source.match(pattern);
    if (!match) throw new Error(`Could not read ${label} — regenerate the wordmark first.`);
    return match[1];
  };
  return {
    path: pick(/WORDMARK_PATH =\s*\n?\s*"([^"]+)"/, "WORDMARK_PATH"),
    transform: pick(/LOCKUP_WORDMARK_TRANSFORM =\s*\n?\s*"([^"]+)"/, "LOCKUP_WORDMARK_TRANSFORM"),
    width: Number(pick(/LOCKUP_WIDTH = (\d+)/, "LOCKUP_WIDTH")),
  };
};

/** The mark, as markup, for the standalone lockup files. */
const MARK_MARKUP = [
  '<circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="58 18" transform="rotate(-58 16 16)"/>',
  '<rect x="10.4" y="9.2" width="2.2" height="13.6" fill="currentColor"/>',
  '<rect x="14.4" y="10.4" width="6.4" height="2.2" fill="currentColor"/>',
  '<rect x="14.4" y="14.9" width="9" height="2.2" fill="currentColor"/>',
  '<rect x="14.4" y="19.4" width="4.2" height="2.2" fill="currentColor"/>',
].join("");

const lockupSvg = ({ path, transform, width }, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 32" width="${width * 4}" height="128" fill="none" color="${color}">` +
  `${MARK_MARKUP}<g transform="${transform}"><path d="${path}" fill="currentColor"/></g></svg>`;

/**
 * Places outlined text with its cap line at `y` and its left edge at `x`, scaled
 * so the capitals stand `capHeight` px tall.
 */
const placeText = (text, { x, y, capHeight: target, weight = 600, trackingEm = -0.02, fill = INK }) => {
  const run = outlineText({ text, weight, trackingEm });
  const scale = target / run.capHeight;
  const top = +(y - run.capOvershoot * scale).toFixed(3);
  return {
    markup: `<g transform="translate(${x} ${top}) scale(${scale.toFixed(5)})"><path d="${run.d}" fill="${fill}"/></g>`,
    width: run.width * scale,
  };
};

/**
 * The social card. Rebuilt rather than recoloured: the old one carried Plane's
 * mark and blue-grey palette, and OG art has to be a raster anyway.
 */
const ogImage = () => {
  const W = 1200;
  const H = 630;
  const lockupHeight = 44;
  const parts = [
    `<rect width="${W}" height="${H}" fill="${CREAM}"/>`,
    // Work-item cards, bleeding off the right edge — a hint of the product.
    ...[0, 1, 2].map((row) => {
      const top = 44 + row * 190;
      const bars = [
        [0, 236, 12],
        [0, 150, 12],
        [26, 196, 12],
      ]
        .map(
          ([dx, w, h], i) =>
            `<rect x="${900 + 34 + dx}" y="${top + 74 + i * 26}" width="${w}" height="${h}" rx="6" fill="#DCD8CE"/>`
        )
        .join("");
      return (
        `<rect x="900" y="${top}" width="340" height="164" rx="14" fill="#FFFFFF" stroke="#DFDCD3" stroke-width="2"/>` +
        `<rect x="934" y="${top + 34}" width="18" height="18" rx="5" fill="#DCD8CE"/>` +
        `<rect x="962" y="${top + 36}" width="72" height="14" rx="7" fill="#C3C1B9"/>` +
        bars
      );
    }),
  ];

  // Brand lockup, then the headline, all optically aligned on the same left margin.
  const lockupScale = lockupHeight / 32;
  const geometry = readLockupGeometry();
  parts.push(
    `<g transform="translate(96 88) scale(${lockupScale.toFixed(5)})" color="${ACCENT}">` +
      `${MARK_MARKUP}<g transform="${geometry.transform}"><path d="${geometry.path}" fill="currentColor"/></g></g>`
  );
  /** Text must clear the card column at x=900, with a 60px gutter. */
  const SAFE_WIDTH = 900 - 96 - 60;
  const headline = [
    placeText("Modern project", { x: 96, y: 238, capHeight: 58 }),
    placeText("management", { x: 96, y: 326, capHeight: 58 }),
    placeText("Powerful, flexible, and built to scale", {
      x: 96,
      y: 430,
      capHeight: 24,
      weight: 500,
      fill: "#5C5A54",
    }),
  ];
  for (const line of headline) {
    if (line.width > SAFE_WIDTH) {
      throw new Error(
        `OG headline is ${Math.round(line.width)}px wide but only ${SAFE_WIDTH}px clears the cards — shorten it or drop the cap height.`
      );
    }
    parts.push(line.markup);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" fill="none">${parts.join("")}</svg>`;
};

const write = (dir, file, data) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, file), data);
  return `${file} (${data.length.toLocaleString()} B)`;
};

const run = async () => {
  const appIconSvg = svg("app-icon.svg");
  const markFlatSvg = svg("mark-flat.svg");
  const ico = buildIco(
    await Promise.all(ICO_SIZES.map(async (size) => ({ size, data: await render("app-icon.svg", size) })))
  );

  for (const app of APPS) {
    const assets = ASSET_DIR(app);
    const publicDir = PUBLIC_DIR(app);
    const written = [];

    // Real vector favicon, plus the single-colour variant Safari pinned tabs want.
    written.push(write(assets, "favicon.svg", appIconSvg));
    written.push(write(assets, "favicon-flat.svg", markFlatSvg));
    written.push(write(assets, "favicon.ico", ico));

    for (const { file, size, source } of ASSET_PNGS) {
      written.push(write(assets, file, await render(source, size)));
    }
    for (const { file, size, source } of PUBLIC_PNGS) {
      written.push(write(publicDir, file, await render(source, size)));
    }

    console.log(`apps/${app}: ${written.length} files`);
    for (const entry of written) console.log(`  ${entry}`);
  }

  // Lockups for contexts that cannot run our components: e-mail, Storybook, OG art.
  const geometry = readLockupGeometry();
  const emailDir = resolve(REPO, "apps/api/plane/static/logos");
  const cream = lockupSvg(geometry, "#F4F2EC");
  console.log("\nlockups:");
  console.log(`  ${write(resolve(BRAND), "lockup-cream.svg", Buffer.from(cream))}`);
  console.log(`  ${write(resolve(BRAND), "lockup-ink.svg", Buffer.from(lockupSvg(geometry, "#0E1116")))}`);
  console.log(
    `  ${write(resolve(REPO, "packages/propel/public"), "cybernetics-lockup-cream.svg", Buffer.from(cream))}`
  );
  // 2x rasters for e-mail clients, which will not render SVG. Cream for the dark
  // masthead, ink for the templates that put the logo on white.
  for (const [name, markup] of [
    ["cybernetics-lockup-cream.png", cream],
    ["cybernetics-lockup-ink.png", lockupSvg(geometry, INK)],
  ]) {
    const png = await sharp(Buffer.from(markup), { density: 384 }).resize({ height: 128 }).png().toBuffer();
    console.log(`  ${write(emailDir, name, png)}`);
  }

  const og = await sharp(Buffer.from(ogImage()), { density: 96 }).png({ compressionLevel: 9 }).toBuffer();
  console.log(`\nsocial card:\n  ${write(resolve(REPO, "apps/web/app/assets"), "og-image.png", og)}`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
