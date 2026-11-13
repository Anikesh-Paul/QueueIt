/**
 * One-shot message (and optional destination) that survives the route-guard
 * redirects around signing in or out. Guards render <Navigate> before a
 * router transition lands, so location.state alone gets dropped.
 */
export const AUTH_FLASH_KEY = "queueit_auth_flash";

function store(storage) {
  if (storage) return storage;
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function setAuthFlash({ notice = "", to = null } = {}, storage) {
  try {
    store(storage)?.setItem(AUTH_FLASH_KEY, JSON.stringify({ notice, to }));
  } catch {
    // ignore
  }
}

export function peekAuthFlash(storage) {
  try {
    const raw = store(storage)?.getItem(AUTH_FLASH_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== "object") return null;
    const to = typeof data.to === "string" && data.to.startsWith("/") && !data.to.startsWith("//") ? data.to : null;
    return { notice: typeof data.notice === "string" ? data.notice : "", to };
  } catch {
    return null;
  }
}

/** Read the notice once (clears it). */
export function takeAuthFlashNotice(storage) {
  const flash = peekAuthFlash(storage);
  try {
    store(storage)?.removeItem(AUTH_FLASH_KEY);
  } catch {
    // ignore
  }
  return flash?.notice || "";
}
