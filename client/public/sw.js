/* QueueIt service worker — versioned app shell + last-known student data.
 *
 * Build: vite.config.js stamps BUILD_ID and PRECACHE_ASSETS into dist/sw.js,
 * so every deploy ships a byte-different worker and browsers pick it up.
 *
 * - Install: precache the app shell (index.html, manifest, icons, the build's
 *   hashed JS/CSS). The first install activates at once; an update waits until
 *   the page asks (SKIP_WAITING from the "New version available" prompt) or
 *   every QueueIt tab is closed.
 * - Activate: delete shell caches from older builds, keep the data cache.
 * - Navigations: network-first, fall back to the cached index.html offline.
 * - Hashed /assets/*: cache-first (immutable). Other static files:
 *   stale-while-revalidate, so icons and the manifest never get stuck.
 * - Student data GETs (catalog, active places, one queue's status):
 *   network-first; on a network failure, the last good copy with
 *   X-QueueIt-Cache: offline and X-QueueIt-Cached-At.
 * - Never cached: anything but GET, auth, admin, Socket.IO, other API calls.
 * - Notifications: queue alerts raised by the page via
 *   registration.showNotification; tapping one focuses /status. A `push`
 *   handler shows server pushes the same way once VAPID is configured.
 */
const BUILD_ID = "dev";
const PRECACHE_ASSETS = [];
const SHELL_PREFIX = "queueit-shell-";
const SHELL_CACHE = `${SHELL_PREFIX}${BUILD_ID}`;
const DATA_CACHE = "queueit-data-v1";
const SHELL_FILES = [
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One missing file must not block the install (or every later update).
      await Promise.allSettled(
        [...SHELL_FILES, ...PRECACHE_ASSETS].map((path) =>
          fetch(new Request(path, { cache: "reload" })).then((res) => {
            if (res && res.ok) return cache.put(path, res);
            return undefined;
          })
        )
      );
      // First install: take over straight away. Updates wait for the prompt.
      if (!self.registration || !self.registration.active) {
        await self.skipWaiting();
      }
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (type === "CLEAR_STATUS_CACHE") {
    event.waitUntil(caches.delete(DATA_CACHE));
  } else if (type === "GET_BUILD_ID" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ buildId: BUILD_ID });
  }
});

async function focusStatus() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if ("focus" in client) {
      if ("navigate" in client && !new URL(client.url).pathname.startsWith("/status")) {
        await client.navigate("/status").catch(() => {});
      }
      return client.focus();
    }
  }
  return self.clients.openWindow ? self.clients.openWindow("/status") : undefined;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(focusStatus());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "QueueIt";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      tag: payload.tag || "queueit",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: payload.data || null,
    })
  );
});

function isSocket(url) {
  return url.protocol === "ws:" || url.protocol === "wss:" || url.pathname.includes("/socket.io");
}

/** Student read-only GETs that may be shown from cache while offline. */
function isDataGet(url, method) {
  if (method !== "GET") return false;
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (path === "/api/queues" || path === "/api/queues/active") return true;
  return /^\/api\/queues\/[a-fA-F0-9]{24}\/status$/.test(path);
}

function isHashedAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/assets/");
}

function isStaticFile(url, request) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return false;
  const dest = request.destination;
  if (["script", "style", "image", "font", "manifest"].includes(dest)) return true;
  return /\.(js|css|woff2?|png|svg|webp|webmanifest|ico)$/i.test(url.pathname);
}

function isNavigation(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" && (request.headers.get("accept") || "").includes("text/html"))
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (request.method !== "GET" || isSocket(url)) return;

  if (isNavigation(request) && url.origin === self.location.origin) {
    event.respondWith(networkFirstNavigation(request));
  } else if (isDataGet(url, request.method)) {
    event.respondWith(networkFirstData(request));
  } else if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request));
  } else if (isStaticFile(url, request)) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
  // Everything else (other API calls, auth, admin, cross-origin) goes straight to the network.
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put("/index.html", response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match("/index.html")) ||
      new Response("QueueIt is offline. Reconnect and try again.", {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  let response;
  try {
    response = await fetch(request);
  } catch (err) {
    const cached = await cache.match(request);
    if (!cached) throw err;
    const headers = new Headers(cached.headers);
    headers.set("X-QueueIt-Cache", "offline");
    const exposed = headers.get("Access-Control-Expose-Headers");
    const extra = "X-QueueIt-Cache, X-QueueIt-Cached-At";
    headers.set("Access-Control-Expose-Headers", exposed ? `${exposed}, ${extra}` : extra);
    return new Response(await cached.blob(), {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }
  if (response && response.ok) {
    const headers = new Headers(response.headers);
    headers.set("X-QueueIt-Cached-At", new Date().toISOString());
    const copy = new Response(await response.clone().blob(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    await cache.put(request, copy);
  } else if (response && (response.status === 401 || response.status === 403 || response.status === 404)) {
    // Signed out or no longer in line: forget the stale copy.
    await cache.delete(request);
  }
  return response;
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    if (event && event.waitUntil) event.waitUntil(refresh);
    return cached;
  }
  const response = await refresh;
  return response || Response.error();
}
