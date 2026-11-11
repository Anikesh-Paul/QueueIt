/** Top-3 near-front rule: position <= 3 (1 = front of the waiting line). */
export const NEAR_FRONT_POSITION_LIMIT = 3;

export const NOTIFY_ENABLED_KEY = "queueit_notify_enabled";
export const NOTIFY_SOUND_KEY = "queueit_notify_sound";
export const NOTIFY_VIBRATE_KEY = "queueit_notify_vibrate";

/**
 * Classify a live-status snapshot into a one-shot alert kind, or null.
 * Paused queues never nudge people toward the counter.
 * @param {{ paused?: boolean, position?: unknown, tokenNumber?: unknown, nowServing?: unknown }} input
 * @returns {"serving"|"next"|"near"|null}
 */
export function resolveQueueAlert({ paused, position, tokenNumber, nowServing, status } = {}) {
  if (paused) return null;
  if (status === "serving") return "serving";
  const token = tokenNumber == null || tokenNumber === "" ? null : Number(tokenNumber);
  const serving = nowServing == null || nowServing === "" ? null : Number(nowServing);
  if (token != null && Number.isFinite(token) && serving != null && Number.isFinite(serving) && serving === token) {
    return "serving";
  }
  if (!Number.isInteger(position) || position < 1) return null;
  if (position === 1) return "next";
  if (position <= NEAR_FRONT_POSITION_LIMIT) return "near";
  return null;
}

export function alertKey(queueId, tokenNumber, kind) {
  if (!kind || !queueId) return null;
  return `${queueId}:${tokenNumber ?? ""}:${kind}`;
}

/**
 * Decide whether to fire a Web Notification for one membership snapshot.
 * Repeating the same kind (polls) does not re-fire. Escalation (near → next
 * → serving) does. Pause clears the last key so a later resume can notify once.
 *
 * @param {{
 *   paused?: boolean,
 *   position?: unknown,
 *   tokenNumber?: unknown,
 *   nowServing?: unknown,
 *   queueId?: string,
 *   lastKey?: string|null,
 * }} input
 */
export function decideNotification({
  paused,
  position,
  tokenNumber,
  nowServing,
  status,
  queueId,
  lastKey,
} = {}) {
  if (paused) {
    return { fire: false, kind: null, key: null, lastKey: null };
  }
  const kind = resolveQueueAlert({ paused, position, tokenNumber, nowServing, status });
  const key = alertKey(queueId, tokenNumber, kind);
  if (!kind || !key) {
    return { fire: false, kind: null, key: null, lastKey };
  }
  if (key === lastKey) {
    return { fire: false, kind, key, lastKey };
  }
  return { fire: true, kind, key, lastKey: key };
}

/**
 * In-page near-front banner (waiting only). Never tells the student to
 * approach the counter — that copy belongs on the called / serving banner.
 * @param {{ position?: number }} input
 * @returns {{ title: string, body: string, kind: "next"|"near" }}
 */
export function nearFrontBannerCopy({ position } = {}) {
  if (position === 1) {
    return {
      kind: "next",
      title: "You're next",
      body: "Stay nearby — you'll be called shortly.",
    };
  }
  const ahead = Number.isInteger(position) ? Math.max(0, position - 1) : 0;
  return {
    kind: "near",
    title: "Near the front",
    body: ahead === 1 ? "1 person ahead." : `${ahead} people ahead.`,
  };
}

/**
 * Notification title/body. Matches the in-page banners.
 * "Approach / come to the counter" is only used when kind is serving.
 * @param {{ kind: "serving"|"next"|"near", position?: number, queueName?: string }} input
 */
export function notificationCopy({ kind, position, queueName } = {}) {
  const queue = queueName || "Queue";
  if (kind === "serving") {
    return {
      title: `You're being called · ${queue}`,
      body: "Please come to the counter.",
    };
  }
  const banner = nearFrontBannerCopy({
    position: kind === "next" ? 1 : position,
  });
  return {
    title: `${banner.title} · ${queue}`,
    body: banner.body,
  };
}

export function isNotificationSupported() {
  return typeof window !== "undefined" && typeof Notification !== "undefined";
}
