/**
 * Poster join links — distinct from arrival-pass `QIT:` payloads.
 *
 * Canonical link is `/join/:queueId`. The poster QR encodes the absolute URL
 * so a phone camera opens the app. A compact `QITJ:<queueId>` payload is also
 * accepted if someone pastes or encodes it by hand.
 */

export const POSTER_PAYLOAD_PREFIX = "QITJ:";

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;

export function isQueueId(value) {
  return typeof value === "string" && OBJECT_ID.test(value);
}

/** In-app path only — no protocol-relative or backslash tricks. */
export function isSafeAppPath(value) {
  if (typeof value !== "string") return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//") || value.includes("\\")) return false;
  if (value.includes("://")) return false;
  return true;
}

export function joinPath(queueId) {
  if (!isQueueId(queueId)) return null;
  return `/join/${queueId}`;
}

export function joinUrl(origin, queueId) {
  const path = joinPath(queueId);
  if (!path || typeof origin !== "string") return null;
  const base = origin.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}${path}`;
}

/** Value encoded in the poster QR: the absolute join URL. */
export function posterQrValue(origin, queueId) {
  return joinUrl(origin, queueId);
}

export function posterPayload(queueId) {
  if (!isQueueId(queueId)) return null;
  return `${POSTER_PAYLOAD_PREFIX}${queueId}`;
}

/**
 * Parse a poster URL, `/join/:id` path, `?join=` query, or compact `QITJ:`
 * payload to a queue id. Arrival passes (`QIT:`) return null.
 * @param {string} raw
 * @returns {string | null}
 */
export function parseJoinTarget(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("QIT:") && !value.startsWith(POSTER_PAYLOAD_PREFIX)) {
    return null;
  }

  if (value.startsWith(POSTER_PAYLOAD_PREFIX)) {
    const id = value.slice(POSTER_PAYLOAD_PREFIX.length).trim();
    return isQueueId(id) ? id : null;
  }

  let path = value;
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      path = `${url.pathname}${url.search}`;
    }
  } catch {
    return null;
  }

  const qIndex = path.indexOf("?");
  if (qIndex !== -1) {
    const params = new URLSearchParams(path.slice(qIndex + 1));
    const joinParam = params.get("join");
    if (isQueueId(joinParam)) return joinParam;
    path = path.slice(0, qIndex);
  }

  const match = path.match(/\/join\/([a-fA-F0-9]{24})\/?$/);
  return match && isQueueId(match[1]) ? match[1] : null;
}

export function kioskPath(queueId) {
  if (!isQueueId(queueId)) return null;
  return `/kiosk/${queueId}`;
}

export function kioskUrl(origin, queueId) {
  const path = kioskPath(queueId);
  if (!path || typeof origin !== "string") return null;
  const base = origin.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}${path}`;
}
