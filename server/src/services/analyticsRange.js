import { now as clockNow } from "./clock.js";
import { campusLocalToUtc, getCampusParts } from "./serviceWindows.js";

/**
 * Resolve an optional analytics time window from query params.
 * `window=today` is the current campus (Asia/Kolkata) calendar day.
 * `from` / `to` are ISO instants (to is exclusive if both are set).
 * Default is all-time (from/to null) so existing callers stay unchanged.
 *
 * @param {{ window?: string, from?: string, to?: string }} query
 * @param {Date} [at]
 * @returns {{ ok: true, from: Date | null, to: Date | null, preset: "all" | "today" | "custom" } | { ok: false, error: string }}
 */
export function resolveAnalyticsRange(query = {}, at = clockNow()) {
  const preset = String(query.window || "").trim().toLowerCase();
  const hasFrom = query.from != null && String(query.from).trim() !== "";
  const hasTo = query.to != null && String(query.to).trim() !== "";

  if (preset === "today") {
    const parts = getCampusParts(at);
    const from = campusLocalToUtc(parts.year, parts.month, parts.day, 0, 0, 0);
    const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
    next.setUTCDate(next.getUTCDate() + 1);
    const to = campusLocalToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0);
    return { ok: true, from, to, preset: "today" };
  }

  if (preset && preset !== "all") {
    return { ok: false, error: "window must be today or all" };
  }

  if (!hasFrom && !hasTo) {
    return { ok: true, from: null, to: null, preset: "all" };
  }

  const from = hasFrom ? new Date(query.from) : null;
  const to = hasTo ? new Date(query.to) : null;
  if (from && Number.isNaN(from.getTime())) return { ok: false, error: "Invalid from" };
  if (to && Number.isNaN(to.getTime())) return { ok: false, error: "Invalid to" };
  if (from && to && to.getTime() <= from.getTime()) {
    return { ok: false, error: "to must be after from" };
  }
  return { ok: true, from, to, preset: "custom" };
}

/** Mongo match fragment for a Date field inside [from, to). */
export function dateRangeMatch(field, range) {
  if (!range?.from && !range?.to) return {};
  const clause = {};
  if (range.from) clause.$gte = range.from;
  if (range.to) clause.$lt = range.to;
  return { [field]: clause };
}
