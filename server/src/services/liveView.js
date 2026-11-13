/**
 * Live staff view: today's numbers for a wall screen.
 *
 * Read-only rollup of the queues this operator can see (org admins only their
 * organizations, staff only their venue / allowed queues). Everything counts
 * from the start of the campus (IST) day except `waitingCount`, which is the
 * live line. Clients poll this (works on Vercel, no socket required).
 *
 * Definitions
 * - servedToday: entries marked served today (servedAt, falling back to updatedAt)
 * - averageWaitMinutes: join → called (calledAt, falling back to served time)
 * - noShowsToday: no-shows recorded today (noShowAt, or legacy skipped rows)
 * - counters: servedToday and servedLastHour per counter (servingCounterId)
 */
import mongoose from "mongoose";
import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import { resolveAnalyticsRange } from "./analyticsRange.js";
import { counterState, DEFAULT_COUNTER_NAME } from "./counters.js";
import { canAccessQueue, resolveVenueFilter, staffQueueIds } from "./staffAccess.js";

export const LIVE_VIEW_REFRESH_SECONDS = 15;
const HOUR_MS = 60 * 60 * 1000;

function round1(value) {
  return Math.round(value * 10) / 10;
}

const SERVED_AT = { $ifNull: ["$servedAt", "$updatedAt"] };
const CALLED_AT = { $ifNull: ["$calledAt", SERVED_AT] };

function emptyTotals() {
  return {
    servedToday: 0,
    servedLastHour: 0,
    averageWaitMinutes: null,
    waitingCount: 0,
    noShowsToday: 0,
    openCounters: 0,
    totalCounters: 0,
    openQueues: 0,
  };
}

/** Pick the counter with the most serves today (ties: most recent hour, then name). */
export function pickBusiest(counters) {
  let best = null;
  for (const c of counters) {
    if (!c.servedToday) continue;
    if (
      !best ||
      c.servedToday > best.servedToday ||
      (c.servedToday === best.servedToday && c.servedLastHour > best.servedLastHour) ||
      (c.servedToday === best.servedToday &&
        c.servedLastHour === best.servedLastHour &&
        String(c.name).localeCompare(String(best.name)) < 0)
    ) {
      best = c;
    }
  }
  return best;
}

/**
 * @param {import("mongoose").Document} user console user with access scope loaded
 * @param {{ venueId?: string, queueId?: string }} query
 * @param {Date} [at]
 */
export async function collectLiveView(user, query = {}, at = clockNow()) {
  const venueParam = query.venueId != null && String(query.venueId).trim() !== "" ? String(query.venueId).trim() : null;
  const queueParam = query.queueId != null && String(query.queueId).trim() !== "" ? String(query.queueId).trim() : null;

  const scoped = await resolveVenueFilter(user, venueParam);
  if (!scoped.ok) return scoped;

  let queues;
  if (queueParam) {
    // Out of scope looks the same as missing: never confirm another org's queue.
    if (!mongoose.isValidObjectId(queueParam)) return { ok: false, status: 404, error: "Queue not found" };
    const queue = await Queue.findOne({ _id: queueParam, ...scoped.filter, archivedAt: null }).populate("venue").exec();
    if (!queue || !canAccessQueue(user, queue)) return { ok: false, status: 404, error: "Queue not found" };
    queues = [queue];
  } else {
    queues = await Queue.find({ ...scoped.filter, archivedAt: null }).populate("venue").sort({ name: 1 }).exec();
    const allowed = staffQueueIds(user);
    queues = queues.filter((queue) => (allowed ? allowed.includes(String(queue._id)) : true) && canAccessQueue(user, queue));
  }

  const range = resolveAnalyticsRange({ window: "today" }, at);
  const hourAgo = new Date(at.getTime() - HOUR_MS);
  const base = {
    generatedAt: at.toISOString(),
    refreshSeconds: LIVE_VIEW_REFRESH_SECONDS,
    day: { from: range.from.toISOString(), to: range.to.toISOString() },
    venue: scoped.venue ? scoped.venue.toPublicJSON() : null,
  };
  if (queues.length === 0) {
    return { ok: true, payload: { ...base, totals: emptyTotals(), busiestCounter: null, queues: [] } };
  }

  const queueIds = queues.map((q) => q._id);
  const servedInDay = {
    $expr: { $and: [{ $gte: [SERVED_AT, range.from] }, { $lt: [SERVED_AT, range.to] }] },
  };

  const [servedRows, waitingRows, noShowRows] = await Promise.all([
    QueueEntry.aggregate([
      { $match: { queue: { $in: queueIds }, status: "served", updatedAt: { $gte: range.from } } },
      { $match: servedInDay },
      {
        $group: {
          _id: { queue: "$queue", counter: "$servingCounterId" },
          served: { $sum: 1 },
          lastHour: { $sum: { $cond: [{ $gte: [SERVED_AT, hourAgo] }, 1, 0] } },
          waitSum: {
            $sum: { $max: [0, { $divide: [{ $subtract: [CALLED_AT, "$createdAt"] }, 60000] }] },
          },
        },
      },
    ]),
    QueueEntry.aggregate([
      { $match: { queue: { $in: queueIds }, status: "waiting" } },
      { $group: { _id: "$queue", count: { $sum: 1 } } },
    ]),
    QueueEntry.aggregate([
      {
        $match: {
          queue: { $in: queueIds },
          $or: [
            { noShowAt: { $gte: range.from, $lt: range.to } },
            { noShowAt: null, status: "skipped", skipReason: { $ne: "staff" }, calledAt: { $ne: null }, skippedAt: { $gte: range.from, $lt: range.to } },
          ],
        },
      },
      { $group: { _id: "$queue", count: { $sum: 1 } } },
    ]),
  ]);

  const waitingBy = new Map(waitingRows.map((r) => [String(r._id), r.count]));
  const noShowBy = new Map(noShowRows.map((r) => [String(r._id), r.count]));
  const servedBy = new Map();
  for (const row of servedRows) {
    const q = String(row._id.queue);
    if (!servedBy.has(q)) servedBy.set(q, []);
    servedBy.get(q).push(row);
  }

  const totals = emptyTotals();
  let waitSumAll = 0;
  const allCounters = [];

  const queueRows = queues.map((queue) => {
    const id = String(queue._id);
    const rows = servedBy.get(id) || [];
    const counterList = Array.isArray(queue.counters) && queue.counters.length
      ? queue.counters
      : [{ _id: null, name: DEFAULT_COUNTER_NAME, nowServing: null }];
    const known = new Set(counterList.map((c) => String(c._id)));
    const counters = counterList.map((c) => {
      const row = rows.find((r) => r._id.counter != null && String(r._id.counter) === String(c._id));
      return {
        id: c._id ? String(c._id) : null,
        name: c.name || DEFAULT_COUNTER_NAME,
        state: counterState(c),
        staffedByName: c.staffedBy ? c.staffedByName || null : null,
        nowServing: c.nowServing ?? null,
        servedToday: row?.served || 0,
        servedLastHour: row?.lastHour || 0,
      };
    });
    // Serves with no (or a since-removed) counter still count for the queue.
    const unassigned = rows.filter((r) => r._id.counter == null || !known.has(String(r._id.counter)));
    const unassignedServed = unassigned.reduce((s, r) => s + r.served, 0);
    if (unassignedServed && counters.length === 1 && counterList[0]._id == null) {
      counters[0].servedToday += unassignedServed;
      counters[0].servedLastHour += unassigned.reduce((s, r) => s + r.lastHour, 0);
    }

    const servedToday = rows.reduce((s, r) => s + r.served, 0);
    const servedLastHour = rows.reduce((s, r) => s + r.lastHour, 0);
    const waitSum = rows.reduce((s, r) => s + r.waitSum, 0);
    const openCounters = counters.filter((c) => c.state === "open").length;
    const isOpen = queue.acceptingTokens !== false;
    const busiest = pickBusiest(counters);

    totals.servedToday += servedToday;
    totals.servedLastHour += servedLastHour;
    totals.waitingCount += waitingBy.get(id) || 0;
    totals.noShowsToday += noShowBy.get(id) || 0;
    totals.openCounters += openCounters;
    totals.totalCounters += counters.length;
    if (isOpen) totals.openQueues += 1;
    waitSumAll += waitSum;
    for (const c of counters) allCounters.push({ ...c, queueId: id, queueName: queue.name });

    return {
      id,
      name: queue.name,
      venue: queue.venue?.name || null,
      status: queue.status,
      acceptingTokens: isOpen,
      nowServing: queue.nowServing ?? null,
      waitingCount: waitingBy.get(id) || 0,
      servedToday,
      servedLastHour,
      averageWaitMinutes: servedToday ? round1(waitSum / servedToday) : null,
      noShowsToday: noShowBy.get(id) || 0,
      openCounters,
      totalCounters: counters.length,
      busiestCounter: busiest ? { id: busiest.id, name: busiest.name, servedToday: busiest.servedToday } : null,
      counters,
    };
  });

  totals.averageWaitMinutes = totals.servedToday ? round1(waitSumAll / totals.servedToday) : null;
  const busiest = pickBusiest(allCounters);

  return {
    ok: true,
    payload: {
      ...base,
      totals,
      busiestCounter: busiest
        ? { queueId: busiest.queueId, queueName: busiest.queueName, id: busiest.id, name: busiest.name, servedToday: busiest.servedToday, servedLastHour: busiest.servedLastHour }
        : null,
      queues: queueRows,
    },
  };
}
