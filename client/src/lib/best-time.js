/** Helpers for the "Best time to come" chart. Pure, so they're unit-tested. */
import { intlLocale } from "./i18n.js";

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** Today's campus (IST) weekday. */
export function campusWeekday(at = new Date()) {
  return new Date(at.getTime() + 330 * 60_000).getUTCDay();
}

/** Localized weekday name; style "short" (Mon) or "long" (Monday). */
export function weekdayName(weekday, locale = "en", style = "short") {
  // 2026-11-01 was a Sunday; use UTC so the browser zone can't shift the day.
  const date = new Date(Date.UTC(2026, 10, 1 + weekday, 12));
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: style, timeZone: "UTC" }).format(date);
}

/** Localized clock hour, e.g. "3 PM" / "3 pm" / "अपराह्न 3". */
export function hourLabel(hour, locale = "en") {
  const date = new Date(Date.UTC(2026, 0, 1, hour, 0));
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: "numeric", hour12: true, timeZone: "UTC" }).format(date);
}

/**
 * Hours worth drawing: from the first to the last open hour (or hour with
 * tickets), so a 9–5 queue isn't squashed into a 24-hour axis.
 */
export function visibleHours(hours) {
  const list = Array.isArray(hours) ? hours : [];
  const keep = list.filter((h) => h.open || h.samples > 0);
  if (!keep.length) return [];
  const first = keep[0].hour;
  const last = keep[keep.length - 1].hour;
  return list.filter((h) => h.hour >= first && h.hour <= last);
}

/** Badge for the current hour: { key, tone } or null. */
export function nowBadge(now) {
  if (!now || !now.open || !now.level) return null;
  if (now.level === "quiet") return { key: "bestTime.nowQuiet", tone: "quiet" };
  if (now.level === "busy") return { key: "bestTime.nowBusy", tone: "busy" };
  return { key: "bestTime.nowSteady", tone: "moderate" };
}

export function levelKey(level) {
  if (level === "quiet") return "bestTime.level.quiet";
  if (level === "moderate") return "bestTime.level.moderate";
  if (level === "busy") return "bestTime.level.busy";
  return "bestTime.level.none";
}

/** Tailwind text colour (used as SVG currentColor) per level. */
export function levelColor(level) {
  if (level === "quiet") return "text-success";
  if (level === "moderate") return "text-warning";
  if (level === "busy") return "text-destructive";
  return "text-border-strong";
}

export function badgeClass(tone) {
  if (tone === "quiet") return "bg-primary-muted text-success";
  if (tone === "busy") return "bg-danger-soft text-danger-ink";
  return "bg-warning-soft text-warning-ink";
}

/** Busiest open hour with data (for the text summary). */
export function busiestHour(hours) {
  const rated = (hours || []).filter((h) => h.open && h.samples > 0);
  if (!rated.length) return null;
  return rated.reduce((a, b) => (b.crowd > a.crowd ? b : a));
}

/** The best hour to recommend: the best remaining hour today, else the day's best. */
export function recommendedHour(data) {
  if (!data?.enough) return null;
  return data.nextBest || data.best || null;
}

/** Bar heights in [minPx, maxPx] scaled to the busiest hour. */
export function barHeights(hours, maxPx, minPx = 2) {
  const max = Math.max(0, ...(hours || []).map((h) => h.crowd || 0));
  return (hours || []).map((h) => (h.crowd > 0 && max > 0 ? Math.max(minPx, Math.round((h.crowd / max) * maxPx)) : 0));
}
