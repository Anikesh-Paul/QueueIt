import { CAMPUS_TIME_ZONE } from "./campus-time.js";
import { intlLocale } from "./i18n.js";

/** Short day label for a campus date (YYYY-MM-DD), e.g. "Mon 16". */
export function formatBookingDay(date, locale = "en") {
  const [y, m, d] = String(date).split("-").map(Number);
  if (!y || !m || !d) return String(date);
  const at = new Date(Date.UTC(y, m - 1, d, 6, 30)); // noon IST
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: CAMPUS_TIME_ZONE,
    weekday: "short",
    day: "numeric",
  }).format(at);
}

/** Slot start as a short campus clock ("11:30"). */
export function formatSlotTime(iso, locale = "en") {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: CAMPUS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(at)
    .replace(/\s?(am|pm)$/i, (s) => s.toUpperCase());
}

/** Split slots into morning / afternoon / evening groups (campus hours). */
export function groupSlots(slots = []) {
  const groups = { morning: [], afternoon: [], evening: [] };
  for (const slot of slots) {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: CAMPUS_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(
        new Date(slot.start)
      )
    );
    if (hour < 12) groups.morning.push(slot);
    else if (hour < 17) groups.afternoon.push(slot);
    else groups.evening.push(slot);
  }
  return Object.entries(groups)
    .filter(([, rows]) => rows.length > 0)
    .map(([key, rows]) => ({ key, slots: rows }));
}

/**
 * Where a booking stands for check-in at `now`.
 * @returns {"early" | "open" | "closed" | "in-line"}
 */
export function checkInState(booking, now = Date.now()) {
  if (!booking) return "closed";
  if (booking.status === "checked-in") return "in-line";
  if (booking.status !== "booked") return "closed";
  const at = typeof now === "number" ? now : new Date(now).getTime();
  const opens = new Date(booking.checkInOpensAt).getTime();
  const closes = new Date(booking.checkInClosesAt).getTime();
  if (Number.isFinite(opens) && at < opens) return "early";
  if (Number.isFinite(closes) && at > closes) return "closed";
  return "open";
}

/** Campus calendar date (YYYY-MM-DD) of an instant. */
export function campusDateOf(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: CAMPUS_TIME_ZONE }).format(at);
}

/** "Mon 16 · 11:30 AM" for a booking line. */
export function formatBookingWhen(iso, locale = "en") {
  return `${formatBookingDay(campusDateOf(iso), locale)} · ${formatSlotTime(iso, locale)}`;
}
