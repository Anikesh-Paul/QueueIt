/**
 * Offline helpers for the student app: a last-known status snapshot kept in
 * localStorage (works with or without the service worker), friendly copy for
 * actions tried while offline, and network-error detection.
 */
import { formatCampusClockTime } from "./campus-time.js";
import { t } from "./i18n.js";

export const OFFLINE_SNAPSHOT_KEY = "queueit_offline_status";
/** A place in line older than this is not worth showing as "last known". */
export const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** True when a request failed because there was no network (not an HTTP error). */
export function isOfflineError(err) {
  if (!err) return false;
  if (err.offline === true) return true;
  return err.status == null && (err.name === "TypeError" || /network|fetch/i.test(String(err.message || "")));
}

/** Who the snapshot belongs to, so one person never sees another's ticket. */
export function snapshotIdentity({ token, guestCredential } = {}) {
  if (token) return `token:${String(token).slice(-16)}`;
  if (guestCredential) return `guest:${String(guestCredential).slice(-12)}`;
  return null;
}

export function saveStatusSnapshot(storage, identity, memberships, savedAt = Date.now()) {
  if (!storage || !identity) return false;
  const list = Array.isArray(memberships) ? memberships.filter((row) => row?.queue?.id) : [];
  try {
    if (list.length === 0) {
      storage.removeItem(OFFLINE_SNAPSHOT_KEY);
      return true;
    }
    storage.setItem(OFFLINE_SNAPSHOT_KEY, JSON.stringify({ v: 1, identity, savedAt, memberships: list }));
    return true;
  } catch {
    return false;
  }
}

export function loadStatusSnapshot(storage, identity, { now = Date.now(), maxAgeMs = SNAPSHOT_MAX_AGE_MS } = {}) {
  if (!storage || !identity) return null;
  try {
    const raw = storage.getItem(OFFLINE_SNAPSHOT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || data.identity !== identity) return null;
    if (!Number.isFinite(data.savedAt) || now - data.savedAt > maxAgeMs) return null;
    if (!Array.isArray(data.memberships) || data.memberships.length === 0) return null;
    return { savedAt: data.savedAt, memberships: data.memberships };
  } catch {
    return null;
  }
}

export function clearStatusSnapshot(storage) {
  try {
    storage?.removeItem(OFFLINE_SNAPSHOT_KEY);
  } catch {
    // ignore
  }
}

/** "as of 10:42 pm" in campus time, or null without a time. */
export function formatAsOf(ms, locale = "en") {
  if (ms == null || !Number.isFinite(Number(ms))) return null;
  return formatCampusClockTime(new Date(Number(ms)).toISOString(), locale);
}

/** Copy for an action that needs the network. */
export function offlineActionMessage(action, locale = "en") {
  if (action === "join") return t(locale, "offline.join");
  if (action === "leave") return t(locale, "offline.leave");
  return t(locale, "offline.generic");
}

/** The error message to show for a failed action, offline-aware. */
export function actionErrorMessage(err, action, locale, fallback) {
  if (isOfflineError(err)) return offlineActionMessage(action, locale);
  return err?.message || fallback;
}

export const OFFLINE_USER_KEY = "queueit_offline_me";

function tokenTag(token) {
  return token ? String(token).slice(-16) : null;
}

/** Remember the signed-in profile so a reload without signal can still open the app. */
export function saveCachedUser(storage, token, user) {
  if (!storage || !token || !user?.id) return;
  const { id, name, email, role } = user;
  try {
    storage.setItem(OFFLINE_USER_KEY, JSON.stringify({ tag: tokenTag(token), user: { id, name, email, role } }));
  } catch {
    // ignore
  }
}

export function loadCachedUser(storage, token) {
  if (!storage || !token) return null;
  try {
    const data = JSON.parse(storage.getItem(OFFLINE_USER_KEY) || "null");
    if (!data || data.tag !== tokenTag(token) || !data.user?.id) return null;
    return data.user;
  } catch {
    return null;
  }
}

export function clearCachedUser(storage) {
  try {
    storage?.removeItem(OFFLINE_USER_KEY);
  } catch {
    // ignore
  }
}
