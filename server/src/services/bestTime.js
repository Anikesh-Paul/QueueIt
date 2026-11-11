import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import { getCampusHour, getCampusWeekday } from "./serviceWindows.js";

export const MIN_ENTRIES_FOR_HINT = 8;
export const MIN_DISTINCT_HOURS_FOR_HINT = 3;
export const BUSYNESS_LOOKBACK_DAYS = 60;
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatCampusHourLabel(hour) {
  const value = ((Number(hour) % 24) + 24) % 24;
  const period = value >= 12 ? "PM" : "AM";
  const twelve = value % 12 === 0 ? 12 : value % 12;
  return `${twelve} ${period}`;
}

export function emptyHourCounts() {
  return Array.from({ length: 7 }, () => Array(24).fill(0));
}

export function bucketJoinTimes(dates) {
  const hours = emptyHourCounts();
  let total = 0;
  for (const raw of dates || []) {
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) continue;
    hours[getCampusWeekday(date)][getCampusHour(date)] += 1;
    total += 1;
  }
  return { hours, total };
}

function observedHours(hourCounts, { minCount = 1 } = {}) {
  return hourCounts
    .map((count, hour) => ({ hour, count }))
    .filter((row) => row.count >= minCount);
}

export function resolveQuietHint(hours, { weekday = null } = {}) {
  const totalsByHour = Array(24).fill(0);
  let total = 0;
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const count = hours?.[day]?.[hour] || 0;
      totalsByHour[hour] += count;
      total += count;
    }
  }
  const overallObserved = observedHours(totalsByHour, { minCount: 2 });
  if (total < MIN_ENTRIES_FOR_HINT || overallObserved.length < MIN_DISTINCT_HOURS_FOR_HINT) {
    return { available: false, reason: "low-data" };
  }

  let candidates = overallObserved;
  let scope = "overall";
  if (weekday != null && weekday >= 0 && weekday <= 6) {
    const dayCounts = hours[weekday] || [];
    const dayTotal = dayCounts.reduce((sum, count) => sum + count, 0);
    const dayObserved = observedHours(dayCounts, { minCount: 2 });
    if (dayTotal >= MIN_ENTRIES_FOR_HINT && dayObserved.length >= MIN_DISTINCT_HOURS_FOR_HINT) {
      candidates = dayObserved;
      scope = "weekday";
    }
  }

  const min = Math.min(...candidates.map((row) => row.count));
  const max = Math.max(...candidates.map((row) => row.count));
  if (min === max) return { available: false, reason: "low-data" };
  const quiet = candidates.find((row) => row.count === min);
  return {
    available: true,
    hour: quiet.hour,
    label: formatCampusHourLabel(quiet.hour),
    scope,
    weekday: scope === "weekday" ? weekday : null,
  };
}

export function busynessJson(hours, { weekday = null } = {}) {
  const hint = resolveQuietHint(hours, { weekday });
  const days = (hours || emptyHourCounts()).map((hourCounts, weekdayIndex) => ({
    weekday: weekdayIndex,
    label: WEEKDAY_LABELS[weekdayIndex],
    hours: hourCounts.slice(),
  }));
  const total = days.reduce(
    (sum, day) => sum + day.hours.reduce((daySum, count) => daySum + count, 0),
    0
  );
  return {
    total,
    days,
    quietHint: hint.available
      ? { hour: hint.hour, label: hint.label, scope: hint.scope }
      : null,
  };
}

export async function collectQueueBusyness(queueId, { at = clockNow(), weekday = null } = {}) {
  const from = new Date(at.getTime() - BUSYNESS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await QueueEntry.find({
    queue: queueId,
    createdAt: { $gte: from },
  })
    .select("createdAt")
    .lean();
  const { hours } = bucketJoinTimes(rows.map((row) => row.createdAt));
  const todayWeekday = weekday != null ? weekday : getCampusWeekday(at);
  return busynessJson(hours, { weekday: todayWeekday });
}

export async function quietHintsByQueueIds(queueIds, { at = clockNow() } = {}) {
  const map = new Map();
  if (!queueIds?.length) return map;
  const from = new Date(at.getTime() - BUSYNESS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await QueueEntry.find({
    queue: { $in: queueIds },
    createdAt: { $gte: from },
  })
    .select("queue createdAt")
    .lean();
  const byQueue = new Map();
  for (const row of rows) {
    const key = String(row.queue);
    if (!byQueue.has(key)) byQueue.set(key, []);
    byQueue.get(key).push(row.createdAt);
  }
  const weekday = getCampusWeekday(at);
  for (const id of queueIds) {
    const key = String(id);
    const { hours } = bucketJoinTimes(byQueue.get(key) || []);
    const hint = resolveQuietHint(hours, { weekday });
    map.set(key, hint.available ? { hour: hint.hour, label: hint.label } : null);
  }
  return map;
}

export async function attachQuietHints(queues, { at = clockNow() } = {}) {
  const hints = await quietHintsByQueueIds(
    (queues || []).map((queue) => queue.id || queue._id),
    { at }
  );
  return (queues || []).map((queue) => ({
    ...queue,
    quietHint: hints.get(String(queue.id || queue._id)) || null,
  }));
}
