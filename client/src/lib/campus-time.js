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
