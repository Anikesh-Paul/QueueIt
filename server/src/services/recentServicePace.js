import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import { campusLocalToUtc, getCampusParts } from "./serviceWindows.js";

/** How many recent served timestamps to consider (campus day). */
export const RECENT_SERVE_LIMIT = 8;
/** Need at least this many positive inter-serve intervals before trusting the sample. */
export const MIN_SERVE_INTERVALS = 3;
export const PACE_FLOOR_FACTOR = 0.5;
export const PACE_CEIL_FACTOR = 2;
export const PACE_MIN_MINUTES = 1;

/**
 * Start of the current campus (Asia/Kolkata) calendar day, using the clock seam.
 * @param {Date} [at]
 */
export function campusDayStart(at = clockNow()) {
  const parts = getCampusParts(at);
  return campusLocalToUtc(parts.year, parts.month, parts.day, 0, 0, 0);
}

/**
 * Average minutes between consecutive serves, or the configured fallback when
 * the sample is too thin. Clamped to [max(1, 0.5×configured), 2×configured].
 *
 * @param {Array<Date|string|number>} servedAtSorted
 * @param {number} configuredAverage
 * @param {{ maxGapMinutes?: number }} [options] gaps longer than this are lulls, not service
 * @returns {{ pace: number, source: "recent"|"configured", sampleSize: number, intervalCount: number }}
 */
export function computeRecentServicePace(servedAtSorted, configuredAverage, { maxGapMinutes = Infinity } = {}) {
  const configured = Number(configuredAverage);
  const fallback = Number.isFinite(configured) && configured > 0 ? configured : 3;
  const times = (Array.isArray(servedAtSorted) ? servedAtSorted : [])
    .map((value) => (value instanceof Date ? value : new Date(value)))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const intervals = [];
  for (let i = 1; i < times.length; i += 1) {
    const minutes = (times[i].getTime() - times[i - 1].getTime()) / 60_000;
    if (minutes > 0 && minutes <= maxGapMinutes) intervals.push(minutes);
  }

  if (intervals.length < MIN_SERVE_INTERVALS) {
    return {
      pace: fallback,
      source: "configured",
      sampleSize: times.length,
      intervalCount: intervals.length,
    };
  }

  const raw = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  const floor = Math.max(PACE_MIN_MINUTES, fallback * PACE_FLOOR_FACTOR);
  const ceil = Math.max(floor, fallback * PACE_CEIL_FACTOR);
  const clamped = Math.min(ceil, Math.max(floor, raw));
  const pace = Math.round(clamped * 10) / 10;
  return {
    pace,
    source: "recent",
    sampleSize: times.length,
    intervalCount: intervals.length,
  };
}

/**
 * Most recent served `updatedAt` values in [from, now], oldest first, capped.
 * @param {import("mongoose").Types.ObjectId|string} queueId
 * @param {{ from?: Date, limit?: number }} [options]
 */
export async function fetchRecentServedAt(queueId, { from, limit = RECENT_SERVE_LIMIT } = {}) {
  if (!queueId) return [];
  const match = { queue: queueId, status: "served" };
  if (from) match.updatedAt = { $gte: from };
  const rows = await QueueEntry.find(match)
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select({ updatedAt: 1 })
    .lean();
  return rows
    .map((row) => row.updatedAt)
    .filter(Boolean)
    .reverse();
}

/**
 * Resolve the pace used for student ETA on one queue.
 * @param {import("mongoose").Document|{ _id: unknown, averageServiceTime?: number }} queue
 */
export async function resolveEtaServicePace(queue) {
  const configured = queue?.averageServiceTime;
  const servedAt = await fetchRecentServedAt(queue._id, { from: campusDayStart() });
  return computeRecentServicePace(servedAt, configured);
}
