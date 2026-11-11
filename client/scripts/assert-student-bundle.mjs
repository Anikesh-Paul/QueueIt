/**
 * After `npm run build:client`, confirm the student entry graph does not
 * statically include the QR-scanner / ZXing chunk.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const htmlPath = path.join(dist, "index.html");
if (!fs.existsSync(htmlPath)) {
  console.error("dist/index.html missing — run npm run build:client first");
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, "utf8");
const entryMatch = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
if (!entryMatch) {
  console.error("Could not find the index entry script in dist/index.html");
  process.exit(1);
}

const entryFile = path.join(dist, entryMatch[1].replace(/^\//, ""));
const entry = fs.readFileSync(entryFile, "utf8");

if (/@zxing|BrowserQRCodeReader/.test(entry)) {
  console.error("Student entry bundle contains ZXing — admin scanner leaked into the initial graph");
  process.exit(1);
}

if (fs.readFileSync(htmlPath, "utf8").includes("modulepreload") && /esm-/.test(html)) {
  console.error("index.html preloads a scanner chunk for every visitor");
  process.exit(1);
}

// Static import of a large esm-* chunk would also pull ZXing on first paint.
const staticEsm = [...entry.matchAll(/(?<!import\()["']\.\/(esm-[^"']+\.js)["']/g)].map((m) => m[1]);
if (staticEsm.length) {
  console.error("Student entry statically imports", staticEsm.join(", "));
  process.exit(1);
}

console.log("Student entry graph looks clean:", path.basename(entryFile));
