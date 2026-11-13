import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

function headersFor(source) {
  const rule = config.headers.find((h) => h.source === source);
  return Object.fromEntries((rule?.headers || []).map((h) => [h.key, h.value]));
}

const csp = headersFor("/(.*)")["Content-Security-Policy"];
const directives = Object.fromEntries(
  csp.split(";").map((part) => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values];
  })
);

describe("web app security headers (client/vercel.json)", () => {
  it("allows the inline theme script by hash — update the hash if index.html changes", () => {
    const inline = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (m) => `'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`
    );
    assert.ok(inline.length > 0);
    for (const hash of inline) assert.ok(directives["script-src"].includes(hash), `missing ${hash}`);
    assert.ok(!directives["script-src"].includes("'unsafe-inline'"));
    assert.ok(!directives["script-src"].includes("'unsafe-eval'"));
  });

  it("keeps the service worker, manifest, API and camera working", () => {
    assert.deepEqual(directives["worker-src"], ["'self'"]);
    assert.deepEqual(directives["manifest-src"], ["'self'"]);
    assert.ok(directives["connect-src"].includes("https://queueit-api.vercel.app"));
    assert.ok(directives["connect-src"].includes("wss://queueit-api.vercel.app"));
    assert.match(headersFor("/(.*)")["Permissions-Policy"], /camera=\(self\)/);
  });

  it("blocks framing, plugins and base-tag tricks", () => {
    assert.deepEqual(directives["frame-ancestors"], ["'none'"]);
    assert.deepEqual(directives["object-src"], ["'none'"]);
    assert.deepEqual(directives["base-uri"], ["'self'"]);
    const all = headersFor("/(.*)");
    assert.equal(all["X-Frame-Options"], "DENY");
    assert.equal(all["X-Content-Type-Options"], "nosniff");
  });

  it("never long-caches the service worker", () => {
    assert.match(headersFor("/sw.js")["Cache-Control"], /no-store/);
    assert.match(headersFor("/assets/(.*)")["Cache-Control"], /immutable/);
  });
});
