/**
 * Service-window schedule helpers (campus time Asia/Kolkata).
 * Hybrid: windows bind target end + messaging; Admin Start is required (no auto-open).
 */

import { now as clockNow } from "./clock.js";

export const CAMPUS_TIME_ZONE = "Asia/Kolkata";

/** IST is fixed UTC+5:30 (no DST). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * @typedef {{ start: string, end: string, days?: number[] }} ServiceWindow
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

const DAY_NAME_TO_INDEX = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

/**
 * Campus weekday 0=Sunday … 6=Saturday in Asia/Kolkata.
 * @param {Date} date
 */
export function getCampusWeekday(date) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return ist.getUTCDay();
}

function parseDayToken(raw) {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 6) {
    return raw;
  }
  if (typeof raw === "string") {
    const token = raw.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(DAY_NAME_TO_INDEX, token)) {
      return DAY_NAME_TO_INDEX[token];
    }
    if (/^[0-6]$/.test(token)) return Number(token);
  }
  return null;
}

/**
 * Normalize optional `days` to a sorted unique 0–6 list, or null for every day.
 * Accepts [1,2,3,4,5], "mon-fri", "1-5", "weekdays", "weekend", or a comma list.
 * @param {unknown} raw
 * @returns {number[] | null}
 */
export function normalizeDays(raw) {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw) && raw.length === 0) return null;

  let tokens = raw;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (!s || s === "every" || s === "everyday" || s === "daily" || s === "all") return null;
    if (s === "weekdays" || s === "mon-fri" || s === "1-5") return [1, 2, 3, 4, 5];
    if (s === "weekend" || s === "weekends" || s === "sat-sun" || s === "0,6" || s === "6,0") {
      return [0, 6];
    }
    const range = /^([0-6]|sun|mon|tue|wed|thu|fri|sat)-([0-6]|sun|mon|tue|wed|thu|fri|sat)$/i.exec(s);
    if (range) {
      const a = parseDayToken(range[1]);
      const b = parseDayToken(range[2]);
      if (a != null && b != null) {
        const days = [];
        let cur = a;
        days.push(cur);
        while (cur !== b) {
          cur = (cur + 1) % 7;
          days.push(cur);
        }
        return [...new Set(days)].sort((x, y) => x - y);
      }
    }
    tokens = s.split(/[,+\s]+/).filter(Boolean);
  }

  if (!Array.isArray(tokens)) return null;
  const days = [...new Set(tokens.map(parseDayToken).filter((d) => d != null))].sort(
    (a, b) => a - b
  );
  if (days.length === 0 || days.length === 7) return null;
  return days;
}

export function windowAppliesOnDay(window, weekday) {
  const days = window?.days;
  if (!Array.isArray(days) || days.length === 0) return true;
  return days.includes(weekday);
}

function daysOverlap(a, b) {
  const left = a == null ? null : a;
  const right = b == null ? null : b;
  if (left == null || right == null) return true;
  return left.some((day) => right.includes(day));
}

function withDays(start, end, days) {
  const row = { start, end };
  if (days && days.length) row.days = days;
  return row;
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
    out.push(withDays(formatMinutesAsHhmm(startMin), formatMinutesAsHhmm(endMin), normalizeDays(plain.days)));
  }
  out.sort((a, b) => {
    const startDiff = parseHhmmToMinutes(a.start) - parseHhmmToMinutes(b.start);
    if (startDiff !== 0) return startDiff;
    const aDay = a.days?.[0] ?? -1;
    const bDay = b.days?.[0] ?? -1;
    return aDay - bDay;
  });
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
    out.push(
      withDays(
        formatMinutesAsHhmm(startMin),
        formatMinutesAsHhmm(endMin),
        normalizeDays(row.days)
      )
    );
  }

  out.sort((a, b) => parseHhmmToMinutes(a.start) - parseHhmmToMinutes(b.start));

  for (let i = 0; i < out.length; i += 1) {
    for (let j = i + 1; j < out.length; j += 1) {
      if (!daysOverlap(out[i].days, out[j].days)) continue;
      const prevEnd = /** @type {number} */ (parseHhmmToMinutes(out[i].end));
      const curStart = /** @type {number} */ (parseHhmmToMinutes(out[j].start));
      if (curStart < prevEnd) {
        return {
          ok: false,
          error: "Service windows must not overlap on the same day",
        };
      }
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
    days: w.days,
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

  for (let offset = 0; offset < 8; offset += 1) {
    const day = offset === 0 ? parts : addCampusDays(parts, offset);
    const weekday = getCampusWeekday(
      campusLocalToUtc(day.year, day.month, day.day, 12, 0)
    );
    const minutes = offset === 0 ? nowMinutes : -1;
    for (const w of parsed) {
      if (!windowAppliesOnDay(w, weekday)) continue;
      if (minutes >= w.endMinutes) continue;
      const sessionEndsAt = campusLocalToUtc(
        day.year,
        day.month,
        day.day,
        Math.floor(w.endMinutes / 60),
        w.endMinutes % 60
      );
      return {
        window: withDays(w.start, w.end, w.days),
        sessionEndsAt,
      };
    }
  }
  return null;
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

  for (let offset = 0; offset < 8; offset += 1) {
    const day = offset === 0 ? parts : addCampusDays(parts, offset);
    const weekday = getCampusWeekday(
      campusLocalToUtc(day.year, day.month, day.day, 12, 0)
    );
    for (const w of parsed) {
      if (!windowAppliesOnDay(w, weekday)) continue;
      const startAt = campusLocalToUtc(
        day.year,
        day.month,
        day.day,
        Math.floor(w.startMinutes / 60),
        w.startMinutes % 60
      );
      if (at.getTime() < startAt.getTime()) {
        return startAt;
      }
    }
  }
  return null;
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
