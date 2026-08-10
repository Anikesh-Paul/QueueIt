/**
 * Service-window schedule helpers (campus time Asia/Kolkata).
 * Hybrid: windows bind target end + messaging; Admin Start is required (no auto-open).
 */

import { now as clockNow } from "./clock.js";

export const CAMPUS_TIME_ZONE = "Asia/Kolkata";

/** IST is fixed UTC+5:30 (no DST). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * @typedef {{ start: string, end: string }} ServiceWindow
 * @typedef {{ startMinutes: number, endMinutes: number, start: string, end: string }} ParsedWindow
 */

/**
 * Parse "HH:mm" to minutes from midnight.
 * @param {string} hhmm
 * @returns {number | null}
 */
export function parseHhmmToMinutes(hhmm) {
  if (typeof hhmm !== "string") return null;
  // Accept HH:mm or HH:mm:ss (HTML time inputs may include seconds).
  const m = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Format minutes from midnight as "HH:mm".
 * @param {number} minutes
 */
export function formatMinutesAsHhmm(minutes) {
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Coerce array-like window input to a plain array.
 * @param {unknown} windows
 * @returns {unknown[]}
 */
function coerceWindowList(windows) {
  if (Array.isArray(windows)) return windows;
  if (windows && typeof windows === "object" && typeof windows.length === "number") {
    return Array.from(windows);
  }
  return [];
}

/**
 * Normalize API/DB window rows; drop invalid.
 * @param {unknown} windows
 * @returns {ServiceWindow[]}
 */
export function normalizeServiceWindows(windows) {
  // Mongoose DocumentArrays are array-like; coerce for safety.
  const list = coerceWindowList(windows);
  /** @type {ServiceWindow[]} */
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const plain =
      typeof row.toObject === "function" ? row.toObject() : row;
    const start = typeof plain.start === "string" ? plain.start.trim() : "";
    const end = typeof plain.end === "string" ? plain.end.trim() : "";
    const startMin = parseHhmmToMinutes(start);
    const endMin = parseHhmmToMinutes(end);
    if (startMin == null || endMin == null || endMin <= startMin) continue;
    out.push({
      start: formatMinutesAsHhmm(startMin),
      end: formatMinutesAsHhmm(endMin),
    });
  }
  out.sort((a, b) => parseHhmmToMinutes(a.start) - parseHhmmToMinutes(b.start));
  return out;
}

/**
 * Strict validate for Admin edit: reject invalid times and overlaps.
 * Adjacent windows (end === next start) are allowed. Overlaps are not.
 * Empty list is allowed (no schedule → no auto-close on start).
 *
 * @param {unknown} windows
 * @returns {{ ok: true, windows: ServiceWindow[] } | { ok: false, error: string }}
 */
export function validateServiceWindows(windows) {
  if (windows == null) {
    return { ok: false, error: "serviceWindows is required" };
  }
  if (!Array.isArray(windows)) {
    return { ok: false, error: "serviceWindows must be an array" };
  }

  /** @type {ServiceWindow[]} */
  const out = [];
  for (let i = 0; i < windows.length; i += 1) {
    const row = windows[i];
    if (!row || typeof row !== "object") {
      return {
        ok: false,
        error: `Invalid service window at index ${i}`,
      };
    }
    const start = typeof row.start === "string" ? row.start.trim() : "";
    const end = typeof row.end === "string" ? row.end.trim() : "";
    const startMin = parseHhmmToMinutes(start);
    const endMin = parseHhmmToMinutes(end);
    if (startMin == null || endMin == null) {
      return {
        ok: false,
        error: `Invalid time format at index ${i}; use HH:mm`,
      };
    }
    if (endMin <= startMin) {
      return {
        ok: false,
        error: `Window end must be after start (index ${i})`,
      };
    }
    out.push({
      start: formatMinutesAsHhmm(startMin),
      end: formatMinutesAsHhmm(endMin),
    });
  }

  out.sort((a, b) => parseHhmmToMinutes(a.start) - parseHhmmToMinutes(b.start));

  for (let i = 1; i < out.length; i += 1) {
    const prevEnd = /** @type {number} */ (parseHhmmToMinutes(out[i - 1].end));
    const curStart = /** @type {number} */ (parseHhmmToMinutes(out[i].start));
    if (curStart < prevEnd) {
      return {
        ok: false,
        error: "Service windows must not overlap",
      };
    }
  }

  return { ok: true, windows: out };
}

/**
 * @param {ServiceWindow[]} windows
 * @returns {ParsedWindow[]}
 */
function parseWindows(windows) {
  return normalizeServiceWindows(windows).map((w) => ({
    start: w.start,
    end: w.end,
    startMinutes: /** @type {number} */ (parseHhmmToMinutes(w.start)),
    endMinutes: /** @type {number} */ (parseHhmmToMinutes(w.end)),
  }));
}

/**
 * Campus (IST) calendar + clock parts for an instant.
 * @param {Date} date
 */
export function getCampusParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CAMPUS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

/**
 * Build a Date for a campus wall time on a calendar day (IST).
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @param {number} [second=0]
 */
export function campusLocalToUtc(year, month, day, hour, minute, second = 0) {
  // Treat components as UTC then subtract IST offset → correct absolute instant.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(asUtc - IST_OFFSET_MS);
}

/**
 * Add calendar days to a campus date parts triple.
 * @param {{ year: number, month: number, day: number }} parts
 * @param {number} days
 */
function addCampusDays(parts, days) {
  // Noon UTC avoids DST edge cases; IST has none but Date math is fine via UTC noon.
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

/**
 * Resolve the target window for Start accepting tokens.
 * Next upcoming window that has not ended (same day), else first window next day.
 *
 * @param {ServiceWindow[]} windows
 * @param {Date} [at]
 * @returns {{ window: ServiceWindow, sessionEndsAt: Date } | null}
 */
export function resolveTargetWindow(windows, at = clockNow()) {
  const parsed = parseWindows(windows);
  if (parsed.length === 0) return null;

  const parts = getCampusParts(at);
  const nowMinutes = parts.hour * 60 + parts.minute;

  for (const w of parsed) {
    if (nowMinutes < w.endMinutes) {
      const sessionEndsAt = campusLocalToUtc(
        parts.year,
        parts.month,
        parts.day,
        Math.floor(w.endMinutes / 60),
        w.endMinutes % 60
      );
      return { window: { start: w.start, end: w.end }, sessionEndsAt };
    }
  }

  // All of today's windows have ended → first window tomorrow.
  const first = parsed[0];
  const nextDay = addCampusDays(parts, 1);
  const sessionEndsAt = campusLocalToUtc(
    nextDay.year,
    nextDay.month,
    nextDay.day,
    Math.floor(first.endMinutes / 60),
    first.endMinutes % 60
  );
  return { window: { start: first.start, end: first.end }, sessionEndsAt };
}

/**
 * Next scheduled window start strictly after `at` (for reopen messaging).
 * @param {ServiceWindow[]} windows
 * @param {Date} [at]
 * @returns {Date | null}
 */
export function nextWindowStartAfter(windows, at = clockNow()) {
  const parsed = parseWindows(windows);
  if (parsed.length === 0) return null;

  const parts = getCampusParts(at);

  for (const w of parsed) {
    const startAt = campusLocalToUtc(
      parts.year,
      parts.month,
      parts.day,
      Math.floor(w.startMinutes / 60),
      w.startMinutes % 60
    );
    if (at.getTime() < startAt.getTime()) {
      return startAt;
    }
  }

  const first = parsed[0];
  const nextDay = addCampusDays(parts, 1);
  return campusLocalToUtc(
    nextDay.year,
    nextDay.month,
    nextDay.day,
    Math.floor(first.startMinutes / 60),
    first.startMinutes % 60
  );
}

/**
 * Default service windows for seed (IST wall times).
 */
export const DEFAULT_SERVICE_WINDOWS = {
  cafeteria: [
    { start: "11:30", end: "14:30" },
    { start: "19:00", end: "21:00" },
  ],
  gym: [{ start: "17:00", end: "21:00" }],
};
