import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildIdFor, precacheList, stampSource } from "../../scripts/stamp-sw.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SW_SOURCE = fs.readFileSync(path.join(here, "../../public/sw.js"), "utf8");
const ORIGIN = "https://queueit.test";
const API = "https://api.queueit.test";
const STATUS_URL = `${API}/api/queues/0123456789abcdef01234567/status`;

function keyOf(req) {
  return typeof req === "string" ? new URL(req, ORIGIN).href : req.url;
}

function makeCaches() {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) {
      const map = new Map();
      stores.set(name, {
        map,
        match: async (req) => map.get(keyOf(req))?.clone(),
        put: async (req, res) => {
          map.set(keyOf(req), res);
        },
        delete: async (req) => map.delete(keyOf(req)),
      });
    }
    return stores.get(name);
  };
  return {
    stores,
    open,
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
}

/** Load sw.js into a sandbox with a fake ServiceWorkerGlobalScope. */
function loadWorker({ source = SW_SOURCE, fetchImpl, active = null } = {}) {
  const listeners = {};
  const caches = makeCaches();
  const calls = { skipWaiting: 0, claim: 0, fetched: [] };
  const self = {
    location: new URL(ORIGIN),
    registration: { active, showNotification: async () => {} },
    clients: { claim: async () => calls.claim++, matchAll: async () => [], openWindow: async () => {} },
    skipWaiting: async () => calls.skipWaiting++,
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
  };
  const fetch = async (req) => {
    calls.fetched.push(typeof req === "string" ? req : req.url);
    return fetchImpl(req);
  };
  // Browsers resolve relative URLs against the worker's location.
  class ScopedRequest extends Request {
    constructor(input, init) {
      super(typeof input === "string" ? new URL(input, ORIGIN).href : input, init);
    }
  }
  const context = vm.createContext({
    self, caches, fetch, Request: ScopedRequest, Response, Headers, URL, Promise, Date, JSON, console,
  });
  vm.runInContext(source, context);
  return { listeners, caches, calls, self };
}

/** Dispatch an event and wait for respondWith / waitUntil to settle. */
async function dispatch(worker, type, init = {}) {
  let responded;
  const waits = [];
  const event = {
    ...init,
    respondWith: (p) => {
      responded = Promise.resolve(p);
    },
    waitUntil: (p) => waits.push(Promise.resolve(p)),
  };
  worker.listeners[type](event);
  const response = responded ? await responded : undefined;
  await Promise.all(waits);
  return { response, responded: Boolean(responded) };
}

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

function fetchEvent(url, { method = "GET", mode = "cors", destination = "", accept = "*/*" } = {}) {
  const request = new Request(url, { method, headers: { Accept: accept } });
  Object.defineProperty(request, "mode", { value: mode });
  Object.defineProperty(request, "destination", { value: destination });
  return { request };
}

describe("service worker: student data (network-first)", () => {
  let online;
  let worker;
  beforeEach(() => {
    online = true;
    worker = loadWorker({
      fetchImpl: async () => {
        if (!online) throw new TypeError("Failed to fetch");
        return json({ position: 3, ticket: "A-12" });
      },
    });
  });

  it("serves the network copy and keeps it for later", async () => {
    const { response } = await dispatch(worker, "fetch", fetchEvent(STATUS_URL));
    assert.equal((await response.json()).position, 3);
    const stored = worker.caches.stores.get("queueit-data-v1").map.get(STATUS_URL);
    assert.ok(stored, "status response cached");
    assert.ok(Date.parse(stored.headers.get("X-QueueIt-Cached-At")) > 0);
  });

  it("falls back to the last good copy offline, flagged for the UI", async () => {
    await dispatch(worker, "fetch", fetchEvent(STATUS_URL));
    online = false;
    const { response } = await dispatch(worker, "fetch", fetchEvent(STATUS_URL));
    assert.equal(response.headers.get("X-QueueIt-Cache"), "offline");
    assert.ok(response.headers.get("X-QueueIt-Cached-At"));
    assert.match(response.headers.get("Access-Control-Expose-Headers"), /X-QueueIt-Cache/);
    assert.equal((await response.json()).ticket, "A-12");
  });

  it("rethrows offline when nothing was cached (the page shows its own copy)", async () => {
    online = false;
    await assert.rejects(dispatch(worker, "fetch", fetchEvent(STATUS_URL)), /Failed to fetch/);
  });

  it("forgets a cached status once the server says the place is gone", async () => {
    const w2 = loadWorker({ fetchImpl: async () => json({ error: "not in line" }, { status: 404 }) });
    await w2.caches.open("queueit-data-v1").then((c) => c.put(STATUS_URL, json({ position: 1 })));
    await dispatch(w2, "fetch", fetchEvent(STATUS_URL));
    assert.equal(w2.caches.stores.get("queueit-data-v1").map.has(STATUS_URL), false);
  });

  it("caches the catalog and active places too", async () => {
    await dispatch(worker, "fetch", fetchEvent(`${API}/api/queues`));
    await dispatch(worker, "fetch", fetchEvent(`${API}/api/queues/active`));
    const map = worker.caches.stores.get("queueit-data-v1").map;
    assert.ok(map.has(`${API}/api/queues`));
    assert.ok(map.has(`${API}/api/queues/active`));
  });
});

describe("service worker: never caches private or write traffic", () => {
  const worker = loadWorker({ fetchImpl: async () => json({ ok: true }) });
  for (const url of [
    `${API}/api/auth/me`,
    `${API}/api/auth/login`,
    `${API}/api/admin/queues/0123456789abcdef01234567/waiting-list`,
    `${API}/api/admin/analytics/report`,
    `${API}/api/queues/history`,
    `${API}/socket.io/?EIO=4&transport=polling`,
  ]) {
    it(`passes ${new URL(url).pathname} straight through`, async () => {
      const { responded } = await dispatch(worker, "fetch", fetchEvent(url));
      assert.equal(responded, false);
    });
  }

  it("ignores POST joins and leaves", async () => {
    const { responded } = await dispatch(
      worker,
      "fetch",
      fetchEvent(`${API}/api/queues/0123456789abcdef01234567/join`, { method: "POST" })
    );
    assert.equal(responded, false);
    assert.equal(worker.caches.stores.has("queueit-data-v1"), false);
  });
});

describe("service worker: app shell", () => {
  it("navigations fall back to the cached index.html offline", async () => {
    let online = true;
    const worker = loadWorker({
      fetchImpl: async () => {
        if (!online) throw new TypeError("offline");
        const res = new Response("<html>shell</html>", { headers: { "Content-Type": "text/html" } });
        Object.defineProperty(res, "type", { value: "basic" });
        return res;
      },
    });
    await dispatch(worker, "fetch", fetchEvent(`${ORIGIN}/status`, { mode: "navigate", accept: "text/html" }));
    online = false;
    const { response } = await dispatch(
      worker,
      "fetch",
      fetchEvent(`${ORIGIN}/status`, { mode: "navigate", accept: "text/html" })
    );
    assert.equal(await response.text(), "<html>shell</html>");
  });

  it("navigations without any cache return a readable offline page", async () => {
    const worker = loadWorker({ fetchImpl: async () => { throw new TypeError("offline"); } });
    const { response } = await dispatch(worker, "fetch", fetchEvent(`${ORIGIN}/`, { mode: "navigate", accept: "text/html" }));
    assert.equal(response.status, 503);
    assert.match(await response.text(), /offline/i);
  });

  it("hashed assets are cache-first", async () => {
    let hits = 0;
    const worker = loadWorker({ fetchImpl: async () => { hits++; return new Response("js"); } });
    const url = `${ORIGIN}/assets/index-abc123.js`;
    await dispatch(worker, "fetch", fetchEvent(url, { destination: "script" }));
    await dispatch(worker, "fetch", fetchEvent(url, { destination: "script" }));
    assert.equal(hits, 1);
  });

  it("unhashed files refresh in the background (stale-while-revalidate)", async () => {
    let version = 1;
    const worker = loadWorker({ fetchImpl: async () => new Response(`v${version}`) });
    const url = `${ORIGIN}/manifest.webmanifest`;
    await dispatch(worker, "fetch", fetchEvent(url, { destination: "manifest" }));
    version = 2;
    const second = await dispatch(worker, "fetch", fetchEvent(url, { destination: "manifest" }));
    assert.equal(await second.response.text(), "v1", "served from cache immediately");
    const third = await dispatch(worker, "fetch", fetchEvent(url, { destination: "manifest" }));
    assert.equal(await third.response.text(), "v2", "updated copy picked up");
  });
});

describe("service worker: install, update and activate", () => {
  const stamped = stampSource(SW_SOURCE, {
    buildId: "build2",
    precache: ["/assets/index-new.js", "/assets/index-new.css"],
  });

  it("precaches the shell and stamped assets, tolerating a missing file", async () => {
    const worker = loadWorker({
      source: stamped,
      fetchImpl: async (req) =>
        req.url.endsWith("/apple-touch-icon.png") ? new Response("", { status: 404 }) : new Response("ok"),
    });
    await dispatch(worker, "install");
    const shell = worker.caches.stores.get("queueit-shell-build2").map;
    assert.ok(shell.has(`${ORIGIN}/index.html`));
    assert.ok(shell.has(`${ORIGIN}/assets/index-new.js`));
    assert.ok(shell.has(`${ORIGIN}/assets/index-new.css`));
    assert.equal(shell.has(`${ORIGIN}/apple-touch-icon.png`), false);
  });

  it("first install takes over immediately", async () => {
    const worker = loadWorker({ source: stamped, fetchImpl: async () => new Response("ok") });
    await dispatch(worker, "install");
    assert.equal(worker.calls.skipWaiting, 1);
  });

  it("an update waits for the page's go-ahead (SKIP_WAITING)", async () => {
    const worker = loadWorker({ source: stamped, fetchImpl: async () => new Response("ok"), active: {} });
    await dispatch(worker, "install");
    assert.equal(worker.calls.skipWaiting, 0);
    await dispatch(worker, "message", { data: { type: "SKIP_WAITING" } });
    assert.equal(worker.calls.skipWaiting, 1);
  });

  it("activate drops old shell caches but keeps last-known data", async () => {
    const worker = loadWorker({ source: stamped, fetchImpl: async () => new Response("ok") });
    await worker.caches.open("queueit-shell-v1");
    await worker.caches.open("queueit-shell-build1");
    await worker.caches.open("queueit-shell-build2");
    await worker.caches.open("queueit-data-v1");
    await dispatch(worker, "activate");
    assert.deepEqual((await worker.caches.keys()).sort(), ["queueit-data-v1", "queueit-shell-build2"]);
    assert.equal(worker.calls.claim, 1);
  });

  it("CLEAR_STATUS_CACHE wipes cached student data (logout)", async () => {
    const worker = loadWorker({ fetchImpl: async () => new Response("ok") });
    await worker.caches.open("queueit-data-v1");
    await dispatch(worker, "message", { data: { type: "CLEAR_STATUS_CACHE" } });
    assert.equal(worker.caches.stores.has("queueit-data-v1"), false);
  });
});

describe("build stamping", () => {
  const bundle = [
    "assets/index-AAA.js",
    "assets/index-BBB.css",
    "assets/button-CCC.js",
    "assets/admin-console-DDD.js",
    "assets/campus-analytics-page-EEE.js",
    "assets/inter-latin-400.woff2",
    "index.html",
  ];

  it("precaches student JS/CSS only", () => {
    assert.deepEqual(precacheList(bundle), [
      "/assets/button-CCC.js",
      "/assets/index-AAA.js",
      "/assets/index-BBB.css",
    ]);
  });

  it("build id changes whenever an asset hash changes", () => {
    const a = buildIdFor(precacheList(bundle));
    const b = buildIdFor(precacheList(bundle.map((f) => f.replace("AAA", "ZZZ"))));
    assert.notEqual(a, b);
    assert.equal(a, buildIdFor(precacheList([...bundle].reverse())), "order-independent");
  });

  it("stamps the placeholders and refuses a worker without them", () => {
    const out = stampSource(SW_SOURCE, { buildId: "abc", precache: ["/assets/x.js"] });
    assert.match(out, /const BUILD_ID = "abc";/);
    assert.match(out, /const PRECACHE_ASSETS = \["\/assets\/x.js"\];/);
    assert.throws(() => stampSource("self.x = 1;", { buildId: "a", precache: [] }), /placeholders/);
  });
});
