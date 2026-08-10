/** Campus wall clock for every user-facing absolute product time. */
export const CAMPUS_TIME_ZONE = "Asia/Kolkata";

/**
 * @param {string | number | Date | null | undefined} iso
 * @returns {Date | null}
 */
function toValidDate(iso) {
  if (iso == null || iso === "") return null;
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * Absolute campus datetime for History and any other non-relative product clock.
 * Shape locked: `10 Aug 2026, 2:05 PM IST` (day mon year, 12h, trailing IST).
 * Always forces Asia/Kolkata — never browser-local product clocks.
 *
 * @param {string | number | Date | null | undefined} iso
 * @returns {string}
 */
export function formatCampusDateTime(iso) {
  const date = toValidDate(iso);
  if (!date) {
    if (iso == null || iso === "") return "—";
    return String(iso);
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CAMPUS_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod").toUpperCase();

  return `${day} ${month} ${year}, ${hour}:${minute} ${dayPeriod} IST`;
}

/**
 * Time-only campus clock for live-status ETA primary (F6 shape: `2:05 PM IST`).
 *
 * @param {string | number | Date | null | undefined} iso
 * @returns {string}
 */
export function formatCampusClockTime(iso) {
  const date = toValidDate(iso);
  if (!date) {
    if (iso == null || iso === "") return "—";
    return String(iso);
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CAMPUS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod").toUpperCase();

  return `${hour}:${minute} ${dayPeriod} IST`;
}

/**
 * Length/pace line from existing ETA inputs only (position + averageServiceTime).
 * Position is 1 = next → people ahead = position − 1. No new ETA formula.
 *
 * @param {number | null | undefined} position
 * @param {number | null | undefined} averageServiceTime
 * @returns {string | null}
 */
export function formatPaceLine(position, averageServiceTime) {
  if (!Number.isFinite(position) || !Number.isFinite(averageServiceTime)) {
    return null;
  }
  const ahead = Math.max(0, Math.trunc(position) - 1);
  const mins = Math.trunc(averageServiceTime);
  return `${ahead} ahead · ~${mins} min each`;
}

/**
 * Present live-status ETA: campus-clock primary; minutes secondary when live.
 * Caller supplies asOfMs: wall-clock “now” while live (remaining wait); a pinned
 * snapshot while Paused so the primary does not slide toward a false arrival.
 *
 * ETA minutes still come from the product rule: position × averageServiceTime (caller).
 *
 * @param {{
 *   etaMinutes: number,
 *   asOfMs: number,
 *   paused?: boolean,
 * }} opts
 * @returns {{
 *   mode: "live" | "frozen",
 *   primary: string,
 *   secondary: string | null,
 *   etaMinutes: number,
 * }}
 */
export function presentLiveEta({ etaMinutes, asOfMs, paused = false }) {
  const minutes = Number(etaMinutes);
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.trunc(minutes)) : 0;
  const arrivalMs = asOfMs + safeMinutes * 60 * 1000;
  const clock = formatCampusClockTime(arrivalMs);
  const primary = clock === "—" ? "—" : `~${clock}`;

  if (paused) {
    return {
      mode: "frozen",
      primary,
      secondary: null,
      etaMinutes: safeMinutes,
    };
  }

  return {
    mode: "live",
    primary,
    secondary: `${safeMinutes} min`,
    etaMinutes: safeMinutes,
  };
}

/**
 * Interpret a `datetime-local` value as campus wall time (Asia/Kolkata), not browser TZ.
 * Input shape: `YYYY-MM-DDTHH:mm` (optional seconds). Returns ISO UTC string or null.
 *
 * @param {string | null | undefined} localValue
 * @returns {string | null}
 */
export function campusDatetimeLocalToIso(localValue) {
  if (localValue == null || localValue === "") return null;
  const raw = String(localValue).trim();
  // datetime-local is timezone-naive; force campus offset (IST is fixed +05:30).
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)
    ? `${raw}:00`
    : raw;
  const date = new Date(`${withSeconds}+05:30`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
