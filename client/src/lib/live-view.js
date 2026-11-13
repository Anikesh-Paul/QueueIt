import { formatNumber, intlLocale, t } from "./i18n.js";

/**
 * Live staff view helpers: URL settings, polling cadence, rotation and labels.
 * The view polls GET /api/admin/live (works on Vercel without a socket).
 */

export const ROTATE_OPTIONS = [0, 10, 20, 30, 60];
export const DEFAULT_REFRESH_SECONDS = 15;
export const MAX_BACKOFF_MS = 60_000;

const QUEUE_ID = /^[a-f0-9]{24}$/i;

/** Read settings from the URL so a TV can bookmark its exact setup. */
export function parseLiveParams(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search || "");
  const queue = params.get("queue");
  const rotate = Number.parseInt(params.get("rotate") || "0", 10);
  return {
    queueId: queue && QUEUE_ID.test(queue) ? queue : null,
    rotateSeconds: ROTATE_OPTIONS.includes(rotate) ? rotate : 0,
    highContrast: params.get("contrast") === "high",
    tv: params.get("tv") === "1",
  };
}

/** Inverse of parseLiveParams; omits defaults so URLs stay short. */
export function liveParamsToSearch({ queueId, rotateSeconds, highContrast, tv } = {}) {
  const params = new URLSearchParams();
  if (queueId && QUEUE_ID.test(queueId)) params.set("queue", queueId);
  if (rotateSeconds && ROTATE_OPTIONS.includes(rotateSeconds)) params.set("rotate", String(rotateSeconds));
  if (highContrast) params.set("contrast", "high");
  if (tv) params.set("tv", "1");
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * Next poll delay. Hidden tabs pause (null). Failures back off 2x per miss,
 * capped at a minute, so a dropped API doesn't get hammered by wall screens.
 */
export function livePollMs({ hidden = false, refreshSeconds = DEFAULT_REFRESH_SECONDS, failures = 0 } = {}) {
  if (hidden) return null;
  const base = Math.max(5, Number(refreshSeconds) || DEFAULT_REFRESH_SECONDS) * 1000;
  if (!failures) return base;
  return Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(failures, 6));
}

/** Data older than three refreshes is shown as stale. */
export function isStale(lastOkMs, nowMs, refreshSeconds = DEFAULT_REFRESH_SECONDS) {
  if (!lastOkMs) return false;
  return nowMs - lastOkMs > Math.max(5, refreshSeconds) * 3000;
}

export function formatAgo(lastOkMs, nowMs, locale = "en") {
  if (!lastOkMs) return t(locale, "live.notUpdated");
  const seconds = Math.max(0, Math.round((nowMs - lastOkMs) / 1000));
  if (seconds < 5) return t(locale, "live.updatedNow");
  if (seconds < 60) return t(locale, "live.updatedSeconds", { n: seconds });
  const minutes = Math.round(seconds / 60);
  return t(locale, "live.updatedMinutes", { n: minutes });
}

export function formatWait(minutes, locale = "en") {
  if (minutes == null || Number.isNaN(Number(minutes))) return "—";
  const value = Number(minutes);
  if (value < 1) return t(locale, "live.lessThanMinute");
  if (value < 60) return t(locale, "live.minutes", { n: Math.round(value) });
  const h = Math.floor(value / 60);
  const m = Math.round(value % 60);
  return m ? t(locale, "live.hoursMinutes", { h, m }) : t(locale, "live.hours", { h });
}

export function counterStateLabel(state, locale = "en") {
  if (state === "break") return t(locale, "live.counter.break");
  if (state === "closed") return t(locale, "live.counter.closed");
  return t(locale, "live.counter.open");
}

/** Whole numbers with Indian grouping (12,34,567). */
export function formatCount(value, locale = "en") {
  return formatNumber(locale, value);
}

/** Width for a throughput bar, never 0 for a non-zero value. */
export function throughputPercent(value, max) {
  const v = Number(value) || 0;
  const m = Number(max) || 0;
  if (!v || !m) return 0;
  return Math.max(4, Math.round((v / m) * 100));
}

/** Queues to rotate through; one or none means no rotation. */
export function rotationQueues(queues, { queueId, rotateSeconds } = {}) {
  if (queueId || !rotateSeconds) return [];
  return (queues || []).length > 1 ? queues : [];
}

export function nextRotationIndex(index, count) {
  if (!count) return 0;
  return (Number(index) + 1) % count;
}

/** The queue being shown full-size: a pinned queue, else the rotation slot, else none (overview). */
export function focusedQueue(queues, { queueId, rotateSeconds, rotationIndex = 0 } = {}) {
  const list = queues || [];
  if (queueId) return list.find((q) => q.id === queueId) || null;
  const rotating = rotationQueues(list, { queueId, rotateSeconds });
  if (!rotating.length) return null;
  return rotating[rotationIndex % rotating.length];
}

/** Campus (IST) wall clock for the header, e.g. "3:05 PM". */
export function formatCampusClock(date, locale = "en") {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date).toUpperCase();
}
