/**
 * Service worker registration and safe updates.
 *
 * - Production only (Vite dev never intercepts HMR or polling).
 * - Checks for a new worker on load, every 30 minutes and whenever the tab
 *   comes back into view, so a deploy is noticed without a manual refresh.
 * - A new worker waits; we raise "queueit:update-available" and the page shows
 *   "New version available". applyServiceWorkerUpdate() tells the waiting worker
 *   to take over and reloads once it does.
 */

import { clearCachedUser, clearStatusSnapshot } from "./offline.js";

export const UPDATE_EVENT = "queueit:update-available";
export const UPDATE_CHECK_MS = 30 * 60 * 1000;

let waitingWorker = null;
let reloadRequested = false;

function announce(worker) {
  if (!worker) return;
  waitingWorker = worker;
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
}

/** True when a newer build is installed and waiting for the page to accept it. */
export function hasPendingUpdate() {
  return Boolean(waitingWorker);
}

/**
 * Watch one registration: a waiting worker, or one that finishes installing
 * while an older worker still controls the page, is a pending update.
 * Exported for tests.
 */
export function watchRegistration(registration, { controller = navigator.serviceWorker?.controller } = {}) {
  if (!registration) return;
  if (registration.waiting && controller) announce(registration.waiting);
  registration.addEventListener?.("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && navigator.serviceWorker?.controller) {
        announce(registration.waiting || installing);
      }
    });
  });
}

export function registerQueueItServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Only reload when the person asked for the new version.
    if (reloadRequested) {
      reloadRequested = false;
      window.location.reload();
    }
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        watchRegistration(registration);
        const check = () => registration.update().catch(() => {});
        setInterval(check, UPDATE_CHECK_MS);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
        window.addEventListener("online", check);
      })
      .catch(() => {
        // Install is optional — the app works without a worker.
      });
  });
}

/** Activate the waiting worker and reload into the new build. */
export function applyServiceWorkerUpdate() {
  const worker = waitingWorker;
  if (!worker) {
    window.location.reload();
    return;
  }
  reloadRequested = true;
  worker.postMessage({ type: "SKIP_WAITING" });
  // If the worker had already taken over, controllerchange won't fire again.
  setTimeout(() => {
    if (reloadRequested) window.location.reload();
  }, 3000);
}

/** Drop cached catalog/status responses on logout so the next session cannot see them. */
export function clearOfflineStatusCache() {
  if (typeof window !== "undefined") {
    clearStatusSnapshot(window.localStorage);
    clearCachedUser(window.localStorage);
  }
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
