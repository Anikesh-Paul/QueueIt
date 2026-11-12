/* QueueIt service worker — app shell + last-known catalog/status cache.
 *
 * - Navigations: network-first, fall back to cached index.html so /join and
 *   /status still boot the SPA when briefly offline.
 * - Same-origin static assets: cache-first once seen.
 * - Catalog, active memberships, and queue status GETs: network-first; on
 *   failure, return the last successful response with X-QueueIt-Cache: offline.
 * - Never caches POST/PUT/PATCH/DELETE, auth, admin APIs, or Socket.IO.
 * - Shows queue alerts raised by the page (registration.showNotification) and
 *   focuses the status page when one is tapped. No server push subscription yet.
 */
const SHELL_CACHE = "queueit-shell-v1";
const DATA_CACHE = "queueit-data-v1";
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
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
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_STATUS_CACHE") {
    event.waitUntil(caches.delete(DATA_CACHE));
  }
});

function isSocket(url) {
  return (
    url.protocol === "ws:" ||
    url.protocol === "wss:" ||
    url.pathname.includes("/socket.io")
  );
}

function isDataGet(url, method) {
  if (method !== "GET") return false;
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (path === "/api/queues") return true;
  if (path === "/api/queues/active") return true;
  return /^\/api\/queues\/[a-fA-F0-9]{24}\/status$/.test(path);
}

function isShellAsset(url, request) {
  if (url.origin !== self.location.origin) return false;
  if (request.method !== "GET") return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (isSocket(url)) return false;
  const dest = request.destination;
  if (["script", "style", "image", "font", "manifest"].includes(dest)) return true;
  return /\.(js|css|woff2?|png|svg|webmanifest|ico)$/i.test(url.pathname);
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
  if (isSocket(url)) return;
  if (request.method !== "GET" && request.method !== "HEAD") return;

  if (isNavigation(request) && url.origin === self.location.origin) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (isDataGet(url, request.method)) {
    event.respondWith(networkFirstData(request));
    return;
  }
  if (isShellAsset(url, request)) {
    event.respondWith(cacheFirstShell(request));
  }
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put("/index.html", response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match("/index.html")) ||
      (await cache.match("/")) ||
      new Response("QueueIt is offline.", {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (!cached) throw err;
    const headers = new Headers(cached.headers);
    headers.set("X-QueueIt-Cache", "offline");
    const exposed = headers.get("Access-Control-Expose-Headers");
    headers.set(
      "Access-Control-Expose-Headers",
      exposed ? `${exposed}, X-QueueIt-Cache` : "X-QueueIt-Cache"
    );
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }
}

async function cacheFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}
