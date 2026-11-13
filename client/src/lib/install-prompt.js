/**
 * "Install app" prompt plumbing. Chrome/Edge/Android fire
 * `beforeinstallprompt` (possibly before React mounts), so we capture it at
 * startup and let the component offer it later. Safari/iOS never fire it, so
 * nothing is shown there.
 */
export const INSTALL_DISMISS_KEY = "queueit_install_dismissed_at";
export const INSTALL_AVAILABLE_EVENT = "queueit:install-available";
export const INSTALL_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

let deferredPrompt = null;

/** Pure rule: offer only when the browser allows it, not installed, not snoozed. */
export function shouldOfferInstall({ available, standalone, dismissedAt, now = Date.now(), snoozeMs = INSTALL_SNOOZE_MS }) {
  if (!available || standalone) return false;
  const at = Number(dismissedAt);
  if (Number.isFinite(at) && at > 0 && now - at < snoozeMs) return false;
  return true;
}

export function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)").matches || window.navigator?.standalone === true
  );
}

export function readInstallDismissedAt(storage) {
  try {
    return Number(storage?.getItem(INSTALL_DISMISS_KEY)) || null;
  } catch {
    return null;
  }
}

export function dismissInstall(storage, now = Date.now()) {
  try {
    storage?.setItem(INSTALL_DISMISS_KEY, String(now));
  } catch {
    // ignore
  }
}

export function hasDeferredInstallPrompt() {
  return Boolean(deferredPrompt);
}

export function captureInstallPrompt() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    window.dispatchEvent(new CustomEvent(INSTALL_AVAILABLE_EVENT));
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    window.dispatchEvent(new CustomEvent(INSTALL_AVAILABLE_EVENT));
  });
}

/** Show the browser's install dialog. Resolves to "accepted" | "dismissed" | "unavailable". */
export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return "unavailable";
  deferredPrompt = null;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome || "dismissed";
  } catch {
    return "dismissed";
  } finally {
    window.dispatchEvent(new CustomEvent(INSTALL_AVAILABLE_EVENT));
  }
}
