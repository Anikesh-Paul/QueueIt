/**
 * Pure helpers for the admin analytics report page (campus time = IST, fixed +05:30).
 */

const CAMPUS_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_REPORT_DAYS = 92;

export const RANGE_PRESETS = [
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "custom", label: "Custom", days: null },
];

/** Campus calendar date (YYYY-MM-DD) for an instant. */
export function campusDate(at = new Date()) {
  return new Date(at.getTime() + CAMPUS_OFFSET_MS).toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD date by whole days. */
export function addDays(dateString, delta) {
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD dates (0 when invalid / reversed). */
export function daysBetween(from, to) {
  if (!isDateString(from) || !isDateString(to)) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (b < a) return 0;
  return Math.round((b - a) / DAY_MS) + 1;
}

export function isDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** Preset id → { from, to } campus dates ending today. */
export function presetRange(presetId, at = new Date()) {
  const preset = RANGE_PRESETS.find((p) => p.id === presetId) || RANGE_PRESETS[1];
  const to = campusDate(at);
  const days = preset.days || 7;
  return { from: addDays(to, -(days - 1)), to };
}

/** Validate a custom range; returns an error message or "". */
export function validateRange(from, to) {
  if (!isDateString(from) || !isDateString(to)) return "Pick a start and end date.";
  const days = daysBetween(from, to);
  if (days === 0) return "The start date must be on or before the end date.";
  if (days > MAX_REPORT_DAYS) return `Pick a range of ${MAX_REPORT_DAYS} days or fewer.`;
  return "";
}

/** Query string for the report endpoint. */
export function reportQuery({ from, to, venueId, queueId } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (venueId) params.set("venueId", venueId);
  if (queueId) params.set("queueId", queueId);
  return params.toString();
}

export function formatRate(rate) {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(rate > 0 && rate < 0.1 ? 1 : 0)}%`;
}

export function formatMinutes(value) {
  if (value == null) return "—";
  const n = Number(value);
  if (n < 1) return "<1 min";
  if (n >= 60) {
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Number.isInteger(n) ? n : n.toFixed(1)} min`;
}

/** 0–23 → "9 AM" style label. */
export function formatHour(hour) {
  if (hour == null) return "—";
  const h = Number(hour);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${period}`;
}

/** "2026-11-11" → "11 Nov" (adds the year when it differs from `currentYear`). */
export function formatShortDate(dateString, currentYear) {
  if (!isDateString(dateString)) return String(dateString || "");
  const [y, m, d] = dateString.split("-").map(Number);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return currentYear && currentYear !== y ? `${d} ${month} ${y}` : `${d} ${month}`;
}

export function formatRangeLabel(from, to) {
  if (!from || !to) return "";
  const year = Number(to.slice(0, 4));
  if (from === to) return formatShortDate(from, year === Number(campusDate().slice(0, 4)) ? year : 0);
  return `${formatShortDate(from, year)} – ${formatShortDate(to, year)} ${year}`;
}

/** A "nice" axis maximum (1, 2, 5 × 10^n) at or above the value; at least 1. */
export function niceMax(value) {
  const v = Math.max(1, Number(value) || 0);
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const step of [1, 2, 5, 10]) {
    if (step * exp >= v) return step * exp;
  }
  return 10 * exp;
}

/** Bar height as a 0–100 percentage of the axis max (non-zero values get a visible minimum). */
export function barPercent(value, max) {
  if (!value || !max) return 0;
  return Math.max(2, Math.min(100, (value / max) * 100));
}

/** Every nth label index for a chart with `count` bars so labels don't collide. */
export function labelStride(count, maxLabels = 8) {
  if (count <= maxLabels) return 1;
  return Math.ceil(count / maxLabels);
}
