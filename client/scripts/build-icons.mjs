/**
 * Rasterise the QueueIt mark into the PWA / favicon icon set.
 *
 *   node client/scripts/build-icons.mjs
 *
 * Reads the vector geometry from src/components/brand/mark-geometry.js and
 * renders it with Playwright's Chromium (already a root devDependency), so the
 * PNGs match what browsers draw from favicon.svg. Writes into client/public/:
 *   favicon.ico (16/32/48), apple-touch-icon.png (180),
 *   icons/icon-{192,512}.png, icons/icon-{192,512}-maskable.png,
 *   og-image.png (1200x630).
 */
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MARK_COLORS, MARK_DOT, MARK_RING, PLATE_RADIUS } from "../src/components/brand/mark-geometry.js";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(clientDir, "public");
const require = createRequire(path.join(clientDir, "package.json"));

/**
 * The mark as an SVG string on the 32 grid.
 * plate: "rounded" (transparent corners) | "square" (full bleed, for maskable / iOS).
 * scale: glyph scale about the plate centre (maskable icons need the 80% safe zone).
 */
function markSvg({ plate = "rounded", scale = 1 } = {}) {
  const rx = plate === "rounded" ? PLATE_RADIUS : 0;
  const t = scale === 1 ? "" : ` transform="translate(16 16) scale(${scale}) translate(-16 -16)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
<rect width="32" height="32" rx="${rx}" fill="${MARK_COLORS.forest}"/>
<g fill="${MARK_COLORS.onForest}"${t}><path d="${MARK_RING}"/><circle cx="${MARK_DOT.cx}" cy="${MARK_DOT.cy}" r="${MARK_DOT.r}"/></g>
</svg>`;
}

async function render(page, html, width, height = width) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block}</style></head><body>${html}</body></html>`
  );
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ omitBackground: true, type: "png" });
}

/** ICO container holding PNG-encoded images (supported by every current browser). */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((im) => im.png)]);
}

async function fontFace(family, pkgFile, weight) {
  const file = require.resolve(pkgFile);
  const data = await readFile(file);
  return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data.toString("base64")}) format("woff2");font-weight:${weight};}`;
}

async function ogHtml() {
  const faces = [
    await fontFace("Source Sans 3", "@fontsource/source-sans-3/files/source-sans-3-latin-600-normal.woff2", 600),
    await fontFace("Fraunces", "@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2", "100 900"),
  ].join("");
  return `<style>${faces}
.og{position:relative;width:1200px;height:630px;background:#f4f1ea;color:#1a1a18;overflow:hidden}
.serif{font-family:"Fraunces",serif;font-variation-settings:"SOFT" 100,"WONK" 0}
.word{position:absolute;left:88px;top:80px;font-weight:600;font-size:44px;letter-spacing:-0.02em}
.line{position:absolute;left:88px;bottom:88px;width:640px;font-weight:560;font-size:62px;line-height:1.08;letter-spacing:-0.025em}
.panel{position:absolute;right:0;top:0;width:400px;height:630px;background:${MARK_COLORS.forest};display:grid;place-items:center}
.panel svg{width:220px;height:220px}
</style>
<div class="og">
  <div class="word serif">QueueIt</div>
  <div class="line serif">Join the line from anywhere. Show up when it’s your turn.</div>
  <div class="panel"><svg viewBox="6 6 20.25 20.25" aria-hidden="true"><g fill="${MARK_COLORS.onForest}"><path d="${MARK_RING}"/><circle cx="${MARK_DOT.cx}" cy="${MARK_DOT.cy}" r="${MARK_DOT.r}"/></g></svg></div>
</div>`;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const out = async (rel, buf) => {
    const file = path.join(publicDir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buf);
    console.log(`wrote ${path.relative(clientDir, file)} (${buf.length} B)`);
  };

  const ico = [];
  for (const size of [16, 32, 48]) ico.push({ size, png: await render(page, markSvg(), size) });
  await out("favicon.ico", packIco(ico));

  // iOS draws its own rounded corners and fills transparency with black: full bleed.
  await out("apple-touch-icon.png", await render(page, markSvg({ plate: "square" }), 180));

  for (const size of [192, 512]) {
    await out(`icons/icon-${size}.png`, await render(page, markSvg(), size));
    await out(`icons/icon-${size}-maskable.png`, await render(page, markSvg({ plate: "square", scale: 0.8 }), size));
  }

  await out("og-image.png", await render(page, await ogHtml(), 1200, 630));
} finally {
  await browser.close();
}

