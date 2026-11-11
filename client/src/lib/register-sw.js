/**
 * Register the production service worker (app shell + last-known status cache).
 * Skipped in Vite dev so HMR and polling are never intercepted locally.
 */

export function registerQueueItServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Install is optional — the app works without a worker.
    });
  });
}

/** Drop cached catalog/status responses on logout so the next session cannot see them. */
export function clearOfflineStatusCache() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  const post = (worker) => {
    worker.postMessage({ type: "CLEAR_STATUS_CACHE" });
  };
  if (navigator.serviceWorker.controller) {
    post(navigator.serviceWorker.controller);
    return;
  }
  navigator.serviceWorker.ready
    .then((reg) => {
      if (reg.active) post(reg.active);
    })
    .catch(() => {});
}
