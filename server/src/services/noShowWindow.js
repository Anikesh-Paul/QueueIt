import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";

export const DEFAULT_NO_SHOW_MINUTES = 5;
export const DEFAULT_NO_SHOW_MODE = "fixed";
export const DEFAULT_NO_SHOW_MIN_MINUTES = 2;
export const DEFAULT_NO_SHOW_MAX_MINUTES = 15;
export const NO_SHOW_MODES = ["fixed", "dynamic"];
export const NO_SHOW_BOUND_MIN = 1;
export const NO_SHOW_BOUND_MAX = 30;
export const DYNAMIC_SAMPLE_LIMIT = 12;
export const DYNAMIC_MIN_SAMPLES = 3;
export const LENGTH_BOOST_CAP = 4;
export const PACE_BOOST_CAP = 3;
export const PACE_BOOST_START = 5;

export function resolveNoShowMinutes(queue) {
  const value = Number(queue?.noShowMinutes);
  if (Number.isFinite(value) && value >= 1) return Math.min(NO_SHOW_BOUND_MAX, Math.trunc(value));
  return DEFAULT_NO_SHOW_MINUTES;
}

export function resolveNoShowMode(queue) {
  return queue?.noShowMode === "dynamic" ? "dynamic" : "fixed";
}

export function resolveNoShowBounds(queue) {
  const rawMin = Number(queue?.noShowMinMinutes);
  const rawMax = Number(queue?.noShowMaxMinutes);
  let min = Number.isFinite(rawMin) && rawMin >= 1 ? Math.min(NO_SHOW_BOUND_MAX, Math.trunc(rawMin)) : DEFAULT_NO_SHOW_MIN_MINUTES;
  let max = Number.isFinite(rawMax) && rawMax >= 1 ? Math.min(NO_SHOW_BOUND_MAX, Math.trunc(rawMax)) : DEFAULT_NO_SHOW_MAX_MINUTES;
  if (min > max) {
    const swap = min;
    min = max;
    max = swap;
  }
  return { min, max };
}

export function median(values) {
  const list = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (list.length === 0) return null;
  const mid = Math.floor(list.length / 2);
  if (list.length % 2 === 1) return list[mid];
  return (list[mid - 1] + list[mid]) / 2;
}

function lengthBoostMinutes(waitingCount) {
  const count = Math.max(0, Number(waitingCount) || 0);
  return Math.min(LENGTH_BOOST_CAP, (count / 5) * 0.5);
}

function paceBoostMinutes(paceMinutes) {
  const pace = Number(paceMinutes);
  if (!Number.isFinite(pace) || pace <= PACE_BOOST_START) return 0;
  return Math.min(PACE_BOOST_CAP, (pace - PACE_BOOST_START) * 0.5);
}

/**
 * Pure dynamic-window calculator. Arrival samples are minutes from call to "I'm here".
 */
export function computeDynamicNoShowMinutes({
  arrivalMinutes = [],
  waitingCount = 0,
  paceMinutes = 0,
  fallbackMinutes = DEFAULT_NO_SHOW_MINUTES,
  min = DEFAULT_NO_SHOW_MIN_MINUTES,
  max = DEFAULT_NO_SHOW_MAX_MINUTES,
} = {}) {
  const samples = (arrivalMinutes || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const fallback = Number.isFinite(Number(fallbackMinutes)) && Number(fallbackMinutes) >= 1
    ? Number(fallbackMinutes)
    : DEFAULT_NO_SHOW_MINUTES;

  let base;
  let source;
  if (samples.length >= DYNAMIC_MIN_SAMPLES) {
    base = median(samples);
    source = "arrivals";
  } else if (samples.length > 0) {
    const typ = median(samples);
    base =
      (typ * samples.length + fallback * (DYNAMIC_MIN_SAMPLES - samples.length)) / DYNAMIC_MIN_SAMPLES;
    source = "mixed";
  } else {
    base = fallback;
    source = "fallback";
  }

  const lengthBoost = lengthBoostMinutes(waitingCount);
  const paceBoost = paceBoostMinutes(paceMinutes);
  const raw = base + lengthBoost + paceBoost;
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const minutes = Math.max(low, Math.min(high, Math.round(raw)));
  return { minutes, source, base, lengthBoost, paceBoost };
}

export async function recentArrivalMinutes(queueId, { limit = DYNAMIC_SAMPLE_LIMIT } = {}) {
  if (!queueId) return [];
  const rows = await QueueEntry.find({
    queue: queueId,
    arrivedAt: { $ne: null },
    calledAt: { $ne: null },
  })
    .sort({ arrivedAt: -1 })
    .limit(limit)
    .select("calledAt arrivedAt")
    .lean();
  return rows
    .map((row) => (new Date(row.arrivedAt).getTime() - new Date(row.calledAt).getTime()) / 60_000)
    .filter((value) => Number.isFinite(value) && value >= 0);
}

/**
 * Resolve the grace window to apply to the next (or current) call.
 * Fixed mode uses noShowMinutes unchanged. Dynamic mode is clamped to admin min/max.
 */
export async function resolveNoShowWindow(queue, { at = clockNow(), waitingCount = null } = {}) {
  const mode = resolveNoShowMode(queue);
  const fixed = resolveNoShowMinutes(queue);
  const bounds = resolveNoShowBounds(queue);
  if (mode === "fixed") {
    return {
      minutes: fixed,
      mode: "fixed",
      min: bounds.min,
      max: bounds.max,
      source: "fixed",
    };
  }

  const [arrivalMinutes, countedWaiting] = await Promise.all([
    recentArrivalMinutes(queue?._id),
    waitingCount == null
      ? QueueEntry.countDocuments({ queue: queue._id, status: "waiting" })
      : Promise.resolve(waitingCount),
  ]);
  const computed = computeDynamicNoShowMinutes({
    arrivalMinutes,
    waitingCount: countedWaiting,
    paceMinutes: Number(queue?.averageServiceTime) || 0,
    fallbackMinutes: fixed,
    min: bounds.min,
    max: bounds.max,
  });
  return {
    minutes: computed.minutes,
    mode: "dynamic",
    min: bounds.min,
    max: bounds.max,
    source: computed.source,
    at: at?.toISOString?.() ?? null,
  };
}

export function noShowConfigForJson(queue) {
  const bounds = resolveNoShowBounds(queue);
  return {
    noShowMinutes: resolveNoShowMinutes(queue),
    noShowMode: resolveNoShowMode(queue),
    noShowMinMinutes: bounds.min,
    noShowMaxMinutes: bounds.max,
    noShowAutoCall: queue?.noShowAutoCall === true,
  };
}
