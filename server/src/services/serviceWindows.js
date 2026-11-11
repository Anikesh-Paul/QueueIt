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

/** Campus hour 0–23 in Asia/Kolkata. */
export function getCampusHour(date) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours();
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
    // endMin < startMin is an overnight window (ends the next campus morning).
    if (startMin == null || endMin == null || endMin === startMin) continue;
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
 * A window with end before start is overnight and ends the next campus morning.
 * Equal start and end is invalid. Empty list is allowed (no schedule → no auto-close on start).
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
    if (endMin === startMin) {
      return {
        ok: false,
        error: `Window cannot start and end at the same time (index ${i})`,
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
    const left = occupancyIntervals(out[i]);
    for (let j = i + 1; j < out.length; j += 1) {
      const right = occupancyIntervals(out[j]);
      if (left.some((a) => right.some((b) => occupanciesOverlap(a, b)))) {
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
 * @param {number} startMin
 * @param {number} endMin
 */
function isOvernightMinutes(startMin, endMin) {
  return endMin < startMin;
}

/**
 * Weekday 0–6 for a campus calendar day (noon IST).
 * @param {{ year: number, month: number, day: number }} day
 */
function weekdayOfCampusDay(day) {
  return getCampusWeekday(campusLocalToUtc(day.year, day.month, day.day, 12, 0));
}

/**
 * Instant the window that starts on `startDay` ends (next morning if overnight).
 * @param {ParsedWindow} window
 * @param {{ year: number, month: number, day: number }} startDay
 */
function sessionEndsAtForStartDay(window, startDay) {
  const endDay = isOvernightMinutes(window.startMinutes, window.endMinutes)
    ? addCampusDays(startDay, 1)
    : startDay;
  return campusLocalToUtc(
    endDay.year,
    endDay.month,
    endDay.day,
    Math.floor(window.endMinutes / 60),
    window.endMinutes % 60
  );
}

/**
 * @param {number[] | null | undefined} days
 * @returns {number[]}
 */
function dayListOrAll(days) {
  return !days || days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : days;
}

/**
 * Occupied [startMin, endMin) slices per weekday, including the next-morning
 * slice of an overnight window.
 * @param {ServiceWindow} window
 * @returns {{ weekday: number, startMin: number, endMin: number }[]}
 */
function occupancyIntervals(window) {
  const startMin = /** @type {number} */ (parseHhmmToMinutes(window.start));
  const endMin = /** @type {number} */ (parseHhmmToMinutes(window.end));
  /** @type {{ weekday: number, startMin: number, endMin: number }[]} */
  const intervals = [];
  for (const day of dayListOrAll(window.days)) {
    if (isOvernightMinutes(startMin, endMin)) {
      intervals.push({ weekday: day, startMin, endMin: 24 * 60 });
      intervals.push({ weekday: (day + 1) % 7, startMin: 0, endMin });
    } else {
      intervals.push({ weekday: day, startMin, endMin });
    }
  }
  return intervals;
}

/**
 * @param {{ weekday: number, startMin: number, endMin: number }} a
 * @param {{ weekday: number, startMin: number, endMin: number }} b
 */
function occupanciesOverlap(a, b) {
  if (a.weekday !== b.weekday) return false;
  // Adjacent end === start is allowed; strict interior overlap is not.
  return a.startMin < b.endMin && b.startMin < a.endMin;
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
 * Campus calendar day as YYYY-MM-DD (Asia/Kolkata).
 * @param {{ year: number, month: number, day: number }} day
 */
export function campusDateString(day) {
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
}

/**
 * Parse a campus calendar date. Rejects impossible days (e.g. 2026-02-31).
 * @param {unknown} raw
 * @returns {{ year: number, month: number, day: number } | null}
 */
export function parseCampusDate(raw) {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * @param {unknown} exceptions
 * @returns {{ date: string, closed: boolean, windows?: ServiceWindow[] }[]}
 */
export function normalizeServiceExceptions(exceptions) {
  const list = Array.isArray(exceptions) ? exceptions : [];
  /** @type {{ date: string, closed: boolean, windows?: ServiceWindow[] }[]} */
  const out = [];
  const seen = new Set();
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const parsed = parseCampusDate(row.date);
    if (!parsed) continue;
    const date = campusDateString(parsed);
    if (seen.has(date)) continue;
    seen.add(date);
    const closed = row.closed === true || row.closed === "true";
    if (closed) {
      out.push({ date, closed: true });
      continue;
    }
    const windows = normalizeServiceWindows(row.windows);
    if (windows.length === 0) {
      out.push({ date, closed: true });
    } else {
      out.push({ date, closed: false, windows });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * Strict validate for Admin edit of exception dates.
 * @param {unknown} exceptions
 * @returns {{ ok: true, exceptions: { date: string, closed: boolean, windows?: ServiceWindow[] }[] } | { ok: false, error: string }}
 */
export function validateServiceExceptions(exceptions) {
  if (exceptions == null) {
    return { ok: true, exceptions: [] };
  }
  if (!Array.isArray(exceptions)) {
    return { ok: false, error: "serviceExceptions must be an array" };
  }

  const seen = new Set();
  /** @type {{ date: string, closed: boolean, windows?: ServiceWindow[] }[]} */
  const out = [];
  for (let i = 0; i < exceptions.length; i += 1) {
    const row = exceptions[i];
    if (!row || typeof row !== "object") {
      return { ok: false, error: `Invalid exception at index ${i}` };
    }
    const parsed = parseCampusDate(row.date);
    if (!parsed) {
      return {
        ok: false,
        error: `Invalid exception date at index ${i}; use YYYY-MM-DD`,
      };
    }
    const date = campusDateString(parsed);
    if (seen.has(date)) {
      return { ok: false, error: `Duplicate exception date ${date}` };
    }
    seen.add(date);
    const closed = row.closed === true || row.closed === "true";
    const hasWindows = Array.isArray(row.windows) && row.windows.length > 0;
    if (closed && hasWindows) {
      return {
        ok: false,
        error: `Closed exception cannot include hours (${date})`,
      };
    }
    if (!closed && !hasWindows) {
      return {
        ok: false,
        error: `Exception ${date} must be closed all day or include hours`,
      };
    }
    if (closed) {
      out.push({ date, closed: true });
      continue;
    }
    const check = validateServiceWindows(row.windows);
    if (!check.ok) {
      return { ok: false, error: `Exception ${date}: ${check.error}` };
    }
    out.push({ date, closed: false, windows: check.windows });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, exceptions: out };
}

/**
 * @param {unknown} exceptions
 * @param {{ year: number, month: number, day: number }} day
 */
function exceptionOnDay(exceptions, day) {
  const date = campusDateString(day);
  return normalizeServiceExceptions(exceptions).find((row) => row.date === date) || null;
}

function dayIsClosed(exceptions, day) {
  return Boolean(exceptionOnDay(exceptions, day)?.closed);
}

/**
 * Windows that start on this campus day. An exception replaces the weekly plan.
 * @param {unknown} weeklyWindows
 * @param {unknown} exceptions
 * @param {{ year: number, month: number, day: number }} day
 * @returns {ParsedWindow[]}
 */
export function windowsStartingOnDay(weeklyWindows, exceptions, day) {
  const ex = exceptionOnDay(exceptions, day);
  if (ex) {
    if (ex.closed) return [];
    return parseWindows(ex.windows);
  }
  const weekday = weekdayOfCampusDay(day);
  return parseWindows(weeklyWindows).filter((w) => windowAppliesOnDay(w, weekday));
}

function midnightOnDay(day) {
  return campusLocalToUtc(day.year, day.month, day.day, 0, 0);
}

function sessionEndHonouringClosedNextDay(window, startDay, exceptions) {
  const endsAt = sessionEndsAtForStartDay(window, startDay);
  if (!isOvernightMinutes(window.startMinutes, window.endMinutes)) return endsAt;
  const nextDay = addCampusDays(startDay, 1);
  if (dayIsClosed(exceptions, nextDay)) return midnightOnDay(nextDay);
  return endsAt;
}

function windowStartOnDay(window, day) {
  return campusLocalToUtc(
    day.year,
    day.month,
    day.day,
    Math.floor(window.startMinutes / 60),
    window.startMinutes % 60
  );
}

/** How far ahead schedule lookup walks (covers a stretch of holidays). */
const SCHEDULE_LOOKAHEAD_DAYS = 21;

/**
 * Resolve the target window for Start accepting tokens.
 * If we are inside a window (including an overnight holdover past midnight),
 * bind that window's end; otherwise bind the next upcoming window's end.
 * Overnight windows end the following campus morning.
 * Exception dates override the weekly plan for that campus day.
 *
 * @param {ServiceWindow[]} windows
 * @param {Date} [at]
 * @param {unknown} [exceptions]
 * @returns {{ window: ServiceWindow, sessionEndsAt: Date } | null}
 */
export function resolveTargetWindow(windows, at = clockNow(), exceptions = []) {
  const parts = getCampusParts(at);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const yesterday = addCampusDays(parts, -1);

  if (!dayIsClosed(exceptions, parts)) {
    const yWindows = windowsStartingOnDay(windows, exceptions, yesterday);
    for (const w of yWindows) {
      if (isOvernightMinutes(w.startMinutes, w.endMinutes) && nowMinutes < w.endMinutes) {
        return {
          window: withDays(w.start, w.end, w.days),
          sessionEndsAt: sessionEndHonouringClosedNextDay(w, yesterday, exceptions),
        };
      }
    }
  }

  const todayWindows = windowsStartingOnDay(windows, exceptions, parts);
  for (const w of todayWindows) {
    const overnight = isOvernightMinutes(w.startMinutes, w.endMinutes);
    if (overnight && nowMinutes >= w.startMinutes) {
      return {
        window: withDays(w.start, w.end, w.days),
        sessionEndsAt: sessionEndHonouringClosedNextDay(w, parts, exceptions),
      };
    }
    if (!overnight && nowMinutes >= w.startMinutes && nowMinutes < w.endMinutes) {
      return {
        window: withDays(w.start, w.end, w.days),
        sessionEndsAt: sessionEndsAtForStartDay(w, parts),
      };
    }
  }

  for (let offset = 0; offset < SCHEDULE_LOOKAHEAD_DAYS; offset += 1) {
    const day = offset === 0 ? parts : addCampusDays(parts, offset);
    let best = null;
    for (const w of windowsStartingOnDay(windows, exceptions, day)) {
      const startAt = windowStartOnDay(w, day);
      if (at.getTime() >= startAt.getTime()) continue;
      if (!best || startAt.getTime() < best.startAt.getTime()) {
        best = {
          window: withDays(w.start, w.end, w.days),
          sessionEndsAt: sessionEndHonouringClosedNextDay(w, day, exceptions),
          startAt,
        };
      }
    }
    if (best) {
      return { window: best.window, sessionEndsAt: best.sessionEndsAt };
    }
  }
  return null;
}

/**
 * Next scheduled window start strictly after `at` (for reopen messaging).
 * Exception dates override the weekly plan for that campus day.
 * @param {ServiceWindow[]} windows
 * @param {Date} [at]
 * @param {unknown} [exceptions]
 * @returns {Date | null}
 */
export function nextWindowStartAfter(windows, at = clockNow(), exceptions = []) {
  const parts = getCampusParts(at);

  for (let offset = 0; offset < SCHEDULE_LOOKAHEAD_DAYS; offset += 1) {
    const day = offset === 0 ? parts : addCampusDays(parts, offset);
    let best = null;
    for (const w of windowsStartingOnDay(windows, exceptions, day)) {
      const startAt = windowStartOnDay(w, day);
      if (at.getTime() >= startAt.getTime()) continue;
      if (!best || startAt.getTime() < best.getTime()) best = startAt;
    }
    if (best) return best;
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
