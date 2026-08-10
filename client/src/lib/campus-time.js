/** Campus wall clock for every user-facing absolute product time. */
export const CAMPUS_TIME_ZONE = "Asia/Kolkata";

/**
 * Absolute campus datetime for History and any other non-relative product clock.
 * Shape locked: `10 Aug 2026, 2:05 PM IST` (day mon year, 12h, trailing IST).
 * Always forces Asia/Kolkata — never browser-local product clocks.
 *
 * @param {string | number | Date | null | undefined} iso
 * @returns {string}
 */
export function formatCampusDateTime(iso) {
  if (iso == null || iso === "") return "—";
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);

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
