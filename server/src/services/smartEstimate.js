import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import {
  PACE_CEIL_FACTOR,
  PACE_FLOOR_FACTOR,
  PACE_MIN_MINUTES,
  campusDayStart,
  computeRecentServicePace,
  fetchRecentServedAt,
} from "./recentServicePace.js";
import { getCampusParts, campusLocalToUtc } from "./serviceWindows.js";

/** How many past weeks of the same weekday + hour feed the typical pace. */
export const HISTORY_WEEKS = 4;
/** Each weekly window spans this many minutes either side of the current hour. */
export const HISTORY_PAD_MINUTES = 30;
/** A gap longer than this is a lull (lunch, closed counter), not service time. */
export const MAX_SERVE_GAP_MINUTES = 30;
/** Need this many intervals across past weeks before trusting history. */
export const MIN_HISTORY_INTERVALS = 5;
/** Cap rows read for history per queue. */
export const HISTORY_ROW_LIMIT = 400;
/** When we only have the configured average, assume this much spread. */
export const CONFIGURED_CV = 0.5;
/** Never claim tighter than this relative spread per serve. */
export const MIN_CV = 0.2;
export const MAX_CV = 1.2;

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Positive gaps (minutes) between consecutive serves, dropping long lulls.
 * @param {Array<Date|string|number>} times
 */
export function serveIntervals(times, { maxGapMinutes = MAX_SERVE_GAP_MINUTES } = {}) {
  const sorted = (Array.isArray(times) ? times : [])
    .map((value) => (value instanceof Date ? value : new Date(value)))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  const out = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const minutes = (sorted[i].getTime() - sorted[i - 1].getTime()) / 60_000;
    if (minutes > 0 && minutes <= maxGapMinutes) out.push(minutes);
  }
  return out;
}

/** Mean and coefficient of variation of a list of minutes. */
export function summarizeIntervals(intervals) {
  const list = (intervals || []).filter((value) => Number.isFinite(value) && value > 0);
  if (!list.length) return { count: 0, mean: null, cv: null };
  const mean = list.reduce((sum, value) => sum + value, 0) / list.length;
  if (list.length < 2) return { count: list.length, mean, cv: null };
  const variance = list.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (list.length - 1);
  return { count: list.length, mean, cv: mean > 0 ? Math.sqrt(variance) / mean : null };
}

function clampPace(value, configured) {
  const floor = Math.max(PACE_MIN_MINUTES, configured * PACE_FLOOR_FACTOR);
  const ceil = Math.max(floor, configured * PACE_CEIL_FACTOR);
  return Math.min(ceil, Math.max(floor, value));
}

/**
 * Weight given to today's pace when history is also available.
 * Grows with today's sample: 3 intervals → 0.51, 7+ → 0.8.
 */
export function recentWeight(recentIntervalCount) {
  const n = Math.max(0, Number(recentIntervalCount) || 0);
  return Math.min(0.8, round1(0.3 + 0.07 * n) || 0);
}

/**
 * Blend today's pace with the typical pace for this weekday + hour.
 * With no history this is exactly the existing recent/configured rule.
 *
 * @param {{
 *   recent: { pace: number, source: "recent"|"configured", intervalCount: number },
 *   history: { count: number, mean: number|null },
 *   configured: number,
 * }} input
 * @returns {{ pace: number, source: "recent"|"configured"|"history"|"blend", recentPace: number|null, typicalPace: number|null, weightRecent: number }}
 */
export function blendPace({ recent, history, configured }) {
  const base = Number(configured) > 0 ? Number(configured) : 3;
  const hasRecent = recent?.source === "recent";
  const hasHistory = (history?.count || 0) >= MIN_HISTORY_INTERVALS && Number.isFinite(history?.mean);
  const typicalPace = hasHistory ? round1(clampPace(history.mean, base)) : null;
  const recentPace = hasRecent ? recent.pace : null;

  if (hasRecent && hasHistory) {
    const weightRecent = recentWeight(recent.intervalCount);
    const pace = round1(weightRecent * recentPace + (1 - weightRecent) * typicalPace);
    return { pace, source: "blend", recentPace, typicalPace, weightRecent };
  }
  if (hasRecent) return { pace: recentPace, source: "recent", recentPace, typicalPace: null, weightRecent: 1 };
  if (hasHistory) return { pace: typicalPace, source: "history", recentPace: null, typicalPace, weightRecent: 0 };
  return { pace: round1(base), source: "configured", recentPace: null, typicalPace: null, weightRecent: 0 };
}

/**
 * Turn a point estimate into a range the student can plan around.
 * Spread per serve is the observed CV; across `position` serves the relative
 * spread shrinks with √position (independent serves), at ~80% coverage.
 *
 * @returns {{ low: number, high: number, confidence: "low"|"medium"|"high" }}
 */
export function estimateRange({ etaMinutes, position, cv, source, sampleSize = 0 }) {
  const eta = Math.max(0, Math.round(Number(etaMinutes) || 0));
  const configuredOnly = source === "configured";
  const perServe = configuredOnly
    ? CONFIGURED_CV
    : Math.min(MAX_CV, Math.max(MIN_CV, Number.isFinite(cv) ? cv : CONFIGURED_CV));
  const n = Math.max(1, Number(position) || 1);
  const spread = Math.min(0.6, Math.max(0.12, (1.28 * perServe) / Math.sqrt(n)));
  let low = Math.max(0, Math.floor(eta * (1 - spread)));
  let high = Math.ceil(eta * (1 + spread));
  if (eta >= 4 && high - low < 2) {
    low = Math.max(0, eta - 1);
    high = eta + 1;
  }
  if (eta < 2) {
    low = eta;
    high = Math.max(eta, 1);
  }
  let confidence = "medium";
  if (configuredOnly) confidence = "low";
  else if (sampleSize >= 12 && spread <= 0.25) confidence = "high";
  return { low, high, confidence };
}

/**
 * Past-week windows around the current campus hour, oldest first.
 * @param {Date} at
 */
export function historyWindows(at = clockNow(), { weeks = HISTORY_WEEKS, padMinutes = HISTORY_PAD_MINUTES } = {}) {
  const parts = getCampusParts(at);
  const hourStart = campusLocalToUtc(parts.year, parts.month, parts.day, parts.hour, 0, 0);
  const windows = [];
  for (let k = weeks; k >= 1; k -= 1) {
    const anchor = hourStart.getTime() - k * 7 * 24 * 60 * 60_000;
    windows.push({
      from: new Date(anchor - padMinutes * 60_000),
      to: new Date(anchor + (60 + padMinutes) * 60_000),
    });
  }
  return windows;
}

/** Served times in past-week windows, bucketed per window. */
export async function fetchHistoryServedAt(queueId, at = clockNow()) {
  const windows = historyWindows(at);
  const rows = await QueueEntry.find({
    queue: queueId,
    status: "served",
    $or: windows.map((window) => ({ updatedAt: { $gte: window.from, $lt: window.to } })),
  })
    .sort({ updatedAt: -1 })
    .limit(HISTORY_ROW_LIMIT)
    .select({ updatedAt: 1 })
    .lean();
  return windows.map((window) =>
    rows
      .map((row) => row.updatedAt)
      .filter((time) => time && time >= window.from && time < window.to)
  );
}

/**
 * Smart pace for one queue: today's serves blended with the same hour on past weeks.
 * Read-only. Returns pace (minutes per place, before staffing) and spread inputs.
 */
export async function resolveSmartPace(queue, { at = clockNow() } = {}) {
  const configured = queue?.averageServiceTime;
  const [todayTimes, historyBuckets] = await Promise.all([
    fetchRecentServedAt(queue._id, { from: campusDayStart(at) }),
    fetchHistoryServedAt(queue._id, at),
  ]);
  const recent = computeRecentServicePace(todayTimes, configured);
  const historyIntervals = historyBuckets.flatMap((bucket) => serveIntervals(bucket));
  const history = summarizeIntervals(historyIntervals);
  const blended = blendPace({ recent, history, configured });
  const pooled = summarizeIntervals([...serveIntervals(todayTimes, { maxGapMinutes: Infinity }), ...historyIntervals]);
  return {
    ...blended,
    cv: pooled.cv,
    sampleSize: (recent.source === "recent" ? recent.intervalCount : 0) + history.count,
    historyCount: history.count,
    recentCount: recent.source === "recent" ? recent.intervalCount : 0,
  };
}

/**
 * Full estimate for someone at `position`, given open-counter staffing.
 */
export function buildEstimate(smart, { position, staffingFactor = 1 }) {
  const pace = staffingFactor === 1 ? smart.pace : round1(smart.pace * staffingFactor);
  const etaMinutes = position == null ? null : position * pace;
  const range =
    etaMinutes == null
      ? null
      : estimateRange({ etaMinutes, position, cv: smart.cv, source: smart.source, sampleSize: smart.sampleSize });
  return { pace, etaMinutes, range };
}

/** Short public summary of what an estimate rests on. */
export function estimateBasisJson(smart) {
  return {
    source: smart.source,
    recentPace: smart.recentPace ?? null,
    typicalPace: smart.typicalPace ?? null,
    recentServes: smart.recentCount ?? 0,
    historyServes: smart.historyCount ?? 0,
    weeks: HISTORY_WEEKS,
  };
}
