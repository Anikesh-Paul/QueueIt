import mongoose from "mongoose";
import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import { normalizeServiceWindows, parseHhmmToMinutes, windowAppliesOnDay } from "./serviceWindows.js";
import { formatCampusHourLabel } from "./bestTime.js";

/**
 * "Best time to come": typical crowd and wait by campus hour for one weekday,
 * from the last LOOKBACK_WEEKS of tickets. Read-only — never writes.
 */
export const LOOKBACK_WEEKS = 8;
export const MIN_TICKETS = 10;
export const MIN_DAYS = 2;
export const CACHE_TTL_MS = 5 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

/** Campus weekday / hour / date key without Intl (IST has a fixed offset). */
export function campusSlot(date) {
  const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return {
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    dayKey: `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`,
  };
}

/**
 * Which campus hours a queue is open on a weekday, from its weekly windows.
 * Returns { known: false } when the queue has no schedule at all.
 */
export function openHoursFor(serviceWindows, weekday) {
  const windows = normalizeServiceWindows(serviceWindows);
  if (!windows.length) return { known: false, hours: new Set() };
  const hours = new Set();
  const mark = (fromMin, toMin) => {
    for (let h = 0; h < 24; h += 1) {
      const s = h * 60;
      const e = s + 60;
      if (Math.min(e, toMin) - Math.max(s, fromMin) > 0) hours.add(h);
    }
  };
  const yesterday = (weekday + 6) % 7;
  for (const w of windows) {
    const start = parseHhmmToMinutes(w.start);
    const end = parseHhmmToMinutes(w.end);
    if (windowAppliesOnDay(w, weekday)) mark(start, end > start ? end : 1440);
    // Overnight window from the day before spills into this morning.
    if (end < start && windowAppliesOnDay(w, yesterday)) mark(0, end);
  }
  return { known: true, hours };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Pure builder (unit-tested). `entries` are this queue's tickets in the lookback
 * window: { createdAt, calledAt?, servedAt? }.
 */
export function buildBestTime({ entries = [], serviceWindows = [], weekday, at = clockNow() }) {
  const nowSlot = campusSlot(at);
  const day = Number.isInteger(weekday) ? weekday : nowSlot.weekday;
  const isToday = day === nowSlot.weekday;
  const open = openHoursFor(serviceWindows, day);

  const counts = Array(24).fill(0);
  const waits = Array.from({ length: 24 }, () => []);
  const days = new Set();
  let earliest = null;
  for (const e of entries) {
    const created = new Date(e.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    if (!earliest || created < earliest) earliest = created;
    const slot = campusSlot(created);
    if (slot.weekday !== day) continue;
    counts[slot.hour] += 1;
    days.add(slot.dayKey);
    const endRaw = e.calledAt || e.servedAt;
    if (endRaw) {
      const mins = (new Date(endRaw).getTime() - created.getTime()) / 60000;
      if (Number.isFinite(mins) && mins >= 0 && mins < 12 * 60) waits[slot.hour].push(mins);
    }
  }
  const sampleSize = counts.reduce((a, b) => a + b, 0);
  const activeDays = days.size;
  const weeksCovered = earliest
    ? Math.min(LOOKBACK_WEEKS, Math.max(1, Math.ceil((at.getTime() - earliest.getTime()) / (7 * DAY_MS))))
    : 0;
  const enough = sampleSize >= MIN_TICKETS && activeDays >= MIN_DAYS;

  const base = {
    weekday: day,
    today: nowSlot.weekday,
    currentHour: nowSlot.hour,
    lookbackWeeks: LOOKBACK_WEEKS,
    weeksCovered,
    scheduleKnown: open.known,
    sampleSize,
    activeDays,
    enough,
    minTickets: MIN_TICKETS,
  };
  if (!enough) return { ...base, hours: [], best: null, nextBest: null, now: null };

  const isOpen = (h) => (open.known ? open.hours.has(h) : counts[h] > 0);
  const hours = counts.map((count, hour) => ({
    hour,
    label: formatCampusHourLabel(hour),
    open: isOpen(hour),
    samples: count,
    crowd: round1(count / activeDays),
    waitMinutes: waits[hour].length ? Math.round(median(waits[hour])) : null,
    level: null,
  }));

  const rated = hours.filter((h) => h.open && h.samples > 0);
  const sortedCrowd = rated.map((h) => h.crowd).sort((a, b) => a - b);
  const lowCut = quantile(sortedCrowd, 1 / 3);
  const highCut = quantile(sortedCrowd, 2 / 3);
  const flat = sortedCrowd.length && sortedCrowd[0] === sortedCrowd[sortedCrowd.length - 1];
  for (const h of rated) {
    if (flat) h.level = "moderate";
    else if (h.crowd <= lowCut) h.level = "quiet";
    else if (h.crowd >= highCut) h.level = "busy";
    else h.level = "moderate";
  }

  const maxCrowd = Math.max(...rated.map((h) => h.crowd), 0) || 1;
  const maxWait = Math.max(...rated.map((h) => h.waitMinutes ?? 0), 0) || 1;
  const score = (h) => {
    const crowd = h.crowd / maxCrowd;
    return h.waitMinutes == null ? crowd : 0.6 * (h.waitMinutes / maxWait) + 0.4 * crowd;
  };
  const pick = (list) => {
    if (!list.length) return null;
    const best = list.reduce((a, b) => (score(b) < score(a) ? b : a));
    return { hour: best.hour, label: best.label, waitMinutes: best.waitMinutes, crowd: best.crowd, level: best.level };
  };
  const best = pick(rated);
  // Only suggest a later slot today if it isn't one of the busy hours.
  const later = isToday ? pick(rated.filter((h) => h.hour >= nowSlot.hour)) : null;
  const nextBest = later && later.level !== "busy" ? later : null;
  const current = hours[nowSlot.hour];
  const now = isToday
    ? { hour: nowSlot.hour, label: current.label, open: current.open, level: current.open ? current.level || "quiet" : null }
    : null;

  return { ...base, hours, best, nextBest, now };
}

/** Compact shape for queue cards: open hours only, no per-hour labels or waits. */
export function compactBestTime(full) {
  return {
    weekday: full.weekday,
    enough: full.enough,
    best: full.best ? { hour: full.best.hour, label: full.best.label } : null,
    nextBest: full.nextBest ? { hour: full.nextBest.hour, label: full.nextBest.label } : null,
    now: full.now,
    bars: full.hours.filter((h) => h.open).map((h) => ({ hour: h.hour, crowd: h.crowd, level: h.level })),
  };
}

// ---- tiny per-instance cache (serverless instances are short-lived anyway) ----
const cache = new Map();
function cacheGet(key, at) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (at.getTime() - hit.at > CACHE_TTL_MS || at.getTime() < hit.at) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}
function cachePut(key, value, at) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: at.getTime(), value });
}
export function clearBestTimeCache() {
  cache.clear();
}

async function ticketsSince(queueIds, at) {
  const from = new Date(at.getTime() - LOOKBACK_WEEKS * 7 * DAY_MS);
  return QueueEntry.find({ queue: { $in: queueIds }, createdAt: { $gte: from, $lte: at } })
    .select("queue createdAt calledAt servedAt")
    .lean();
}

/** Full chart for one queue. Returns null when the queue doesn't exist or is archived. */
export async function bestTimeForQueue(queueId, { weekday, at = clockNow() } = {}) {
  const day = Number.isInteger(weekday) ? weekday : campusSlot(at).weekday;
  const key = `q|${queueId}|${day}|${campusSlot(at).dayKey}|${campusSlot(at).hour}`;
  const cached = cacheGet(key, at);
  if (cached) return cached;
  const queue = await Queue.findOne({ _id: queueId, archivedAt: null }).select("name serviceWindows").lean();
  if (!queue) return null;
  const entries = await ticketsSince([queue._id], at);
  const value = { queueId: String(queue._id), name: queue.name, ...buildBestTime({ entries, serviceWindows: queue.serviceWindows, weekday: day, at }) };
  cachePut(key, value, at);
  return value;
}

/** Compact charts for every listed queue (one query). */
export async function bestTimeSummary({ weekday, at = clockNow() } = {}) {
  const day = Number.isInteger(weekday) ? weekday : campusSlot(at).weekday;
  const key = `all|${day}|${campusSlot(at).dayKey}|${campusSlot(at).hour}`;
  const cached = cacheGet(key, at);
  if (cached) return cached;
  const queues = await Queue.find({ status: { $in: ["open", "paused"] }, archivedAt: null })
    .select("serviceWindows")
    .lean();
  const entries = queues.length ? await ticketsSince(queues.map((q) => q._id), at) : [];
  const byQueue = new Map(queues.map((q) => [String(q._id), []]));
  for (const e of entries) byQueue.get(String(e.queue))?.push(e);
  const value = {
    weekday: day,
    today: campusSlot(at).weekday,
    currentHour: campusSlot(at).hour,
    queues: queues.map((q) => ({
      queueId: String(q._id),
      ...compactBestTime(buildBestTime({ entries: byQueue.get(String(q._id)), serviceWindows: q.serviceWindows, weekday: day, at })),
    })),
  };
  cachePut(key, value, at);
  return value;
}

/** Validate an optional ?weekday= (0 = Sunday … 6 = Saturday). */
export function parseWeekday(raw) {
  if (raw == null || raw === "") return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 6) return { ok: false };
  return { ok: true, value: n };
}

export function isQueueIdLike(id) {
  return mongoose.isValidObjectId(id);
}

export const BEST_TIME_CACHE_HEADER = "public, max-age=120, s-maxage=300, stale-while-revalidate=600";
