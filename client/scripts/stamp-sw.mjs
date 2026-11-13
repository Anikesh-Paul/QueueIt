import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Staff-only chunks are fetched on demand, not precached for students. */
const SKIP = /^assets\/(admin-|campus-analytics-|analytics-page-|poster-page-)/;

/** Which built files go into the app-shell precache. */
export function precacheList(assets) {
  return assets
    .filter((file) => /^assets\/.+\.(js|css)$/.test(file) && !SKIP.test(file))
    .sort()
    .map((file) => `/${file}`);
}

/** Stable per build: the asset names already carry content hashes. */
export function buildIdFor(list, extra = "") {
  return crypto.createHash("sha256").update(list.join("\n") + extra).digest("hex").slice(0, 12);
}

export function stampSource(source, { buildId, precache }) {
  const stamped = source
    .replace(/const BUILD_ID = "[^"]*";/, `const BUILD_ID = ${JSON.stringify(buildId)};`)
    .replace(/const PRECACHE_ASSETS = \[\];/, `const PRECACHE_ASSETS = ${JSON.stringify(precache)};`);
  if (stamped === source) throw new Error("sw.js placeholders not found");
  return stamped;
}

export function stampServiceWorker({ outDir, assets }) {
  const file = path.join(outDir, "sw.js");
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const precache = precacheList(assets);
  const index = fs.existsSync(path.join(outDir, "index.html"))
    ? fs.readFileSync(path.join(outDir, "index.html"), "utf8")
    : "";
  const buildId = buildIdFor(precache, index);
  fs.writeFileSync(file, stampSource(fs.readFileSync(file, "utf8"), { buildId, precache }));
  return { buildId, precache };
}
