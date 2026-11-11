import { CAMPUS_TIME_ZONE } from "./campus-time.js";

/**
 * Campus (Asia/Kolkata) calendar day as YYYY-MM-DD.
 * @param {Date} [now]
 */
export function campusTodayDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CAMPUS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Student-facing line for today's exception, or null when the weekly plan applies.
 * @param {{ date?: string, closed?: boolean, windows?: { start: string, end: string }[] }[] | null | undefined} exceptions
 * @param {Date} [now]
 */
export function describeTodayException(exceptions, now = new Date()) {
  if (!Array.isArray(exceptions) || exceptions.length === 0) return null;
  const today = campusTodayDateString(now);
  const match = exceptions.find((row) => row?.date === today);
  if (!match) return null;
  if (match.closed) return "Closed today (holiday hours).";
  const hours = (match.windows || [])
    .map((window) => `${window.start}–${window.end}`)
    .filter(Boolean)
    .join(", ");
  return hours ? `Holiday hours today: ${hours} IST.` : "Closed today (holiday hours).";
}
