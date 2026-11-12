import { CAMPUS_TIME_ZONE, formatCampusClockTime } from "./campus-time.js";

export const TITLE_MAX = 80;
export const BODY_MAX = 280;
export const TONES = ["info", "delay", "closure"];
const DISMISSED_KEY = "queueit_hidden_notices";

/** Notices that apply to one queue: campus-wide, its venue, or the queue itself. */
export function forQueue(list, queueId, venueId) {
  return (list || []).filter(
    (a) =>
      a.scope === "campus" ||
      (a.scope === "venue" && venueId && a.venueId === String(venueId)) ||
      (a.scope === "queue" && queueId && a.queueId === String(queueId))
  );
}

/** Closures first, then delays, then info; newest first within a tone. */
export function sortNotices(list) {
  const rank = { closure: 0, delay: 1, info: 2 };
  return [...(list || [])].sort(
    (a, b) => (rank[a.tone] ?? 3) - (rank[b.tone] ?? 3) || String(b.startsAt).localeCompare(String(a.startsAt))
  );
}

/** An edit re-shows a notice someone hid, so the key includes updatedAt. */
export function dismissKey(a) {
  return `${a.id}:${a.updatedAt || ""}`;
}

export function readHidden() {
  try {
    const list = JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
    return Array.isArray(list) ? list.filter((k) => typeof k === "string").slice(-100) : [];
  } catch {
    return [];
  }
}

export function writeHidden(list) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(list.slice(-100)));
  } catch {
    // Storage blocked: the notice shows again next visit.
  }
}

export function visibleNotices(list, hidden) {
  const set = new Set(hidden || []);
  return sortNotices(list).filter((a) => !set.has(dismissKey(a)));
}

function campusDay(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CAMPUS_TIME_ZONE }).format(new Date(ms));
}

/** "until 6:00 PM IST" today, or "until Sat 14 Nov, 6:00 PM IST" on a later day. */
export function untilLabel(endsAt, nowMs = Date.now(), locale = "en") {
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return "";
  const time = formatCampusClockTime(endsAt, locale);
  if (campusDay(end) === campusDay(nowMs)) return time;
  const day = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-GB", {
    timeZone: CAMPUS_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(end));
  return `${day}, ${time}`;
}

/** Console form: datetime-local value (IST) for an ISO instant. */
export function toCampusInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CAMPUS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Who a notice reaches, in console words. */
export function audienceLabel(a) {
  if (a.scope === "campus") return "Everyone on campus";
  if (a.scope === "venue") return a.venueName ? `Everyone at ${a.venueName}` : "One venue";
  return a.queueName ? `${a.queueName} line` : "One queue";
}
