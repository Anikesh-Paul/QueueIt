import mongoose from "mongoose";
import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import { autoPrepareIfClosedEmpty } from "./queueSession.js";
import { emitQueueChanged } from "./realtime.js";
import {
  counterNameOf,
  ensureDefaultCounters,
  resolveTargetCounter,
  setCounterNowServing,
  completeCounterTurn,
} from "./counters.js";
import { resolveNoShowWindow } from "./noShowWindow.js";
import { applyServedFairness, claimNextWaiting } from "./priorityLane.js";

export { DEFAULT_NO_SHOW_MINUTES, resolveNoShowMinutes } from "./noShowWindow.js";

function toIsoOrNull(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Remaining milliseconds on a serving entry, or null if not in a timed call.
 * When the queue is paused, uses the frozen remainder.
 */
export function remainingServingMs(entry, { paused = false, at = clockNow() } = {}) {
  if (!entry || entry.status !== "serving") return null;
  if (paused || entry.servingDeadlineAt == null) {
    if (entry.servingPausedRemainingMs == null) return null;
    return Math.max(0, Number(entry.servingPausedRemainingMs));
  }
  return Math.max(0, new Date(entry.servingDeadlineAt).getTime() - at.getTime());
}

export function servingFieldsForJson(entry, { paused = false, at = clockNow(), queue = null } = {}) {
  const counterId = entry?.servingCounterId?.toString?.() ?? null;
  const counterName = counterId ? counterNameOf(queue, counterId) : null;
  const counterFields = {
    servingCounterId: counterId,
    servingCounterName: counterName,
  };
  if (!entry || entry.status !== "serving") {
    return {
      calledAt: null,
      servingDeadlineAt: null,
      servingRemainingSeconds: null,
      servingTimerFrozen: false,
      here: false,
      arrivedAt: null,
      noShowWindowMinutes: null,
      noShowWindowMode: null,
      ...counterFields,
    };
  }
  const remaining = remainingServingMs(entry, { paused, at });
  return {
    calledAt: toIsoOrNull(entry.calledAt),
    servingDeadlineAt: toIsoOrNull(entry.servingDeadlineAt),
    servingRemainingSeconds: remaining == null ? null : Math.ceil(remaining / 1000),
    servingTimerFrozen: Boolean(paused),
    here: Boolean(entry.arrivedAt),
    arrivedAt: toIsoOrNull(entry.arrivedAt),
    noShowWindowMinutes: entry.noShowWindowMinutes ?? null,
    noShowWindowMode: entry.noShowWindowMode ?? null,
    ...counterFields,
  };
}

export function clearServingTimer() {
  return {
    servingDeadlineAt: null,
    servingPausedRemainingMs: null,
    arrivedAt: null,
    noShowWindowMinutes: null,
    noShowWindowMode: null,
  };
}

async function busyCounterIds(queue) {
  const rows = await QueueEntry.find({ queue: queue._id, status: "serving" }).select(
    "servingCounterId"
  );
  const ids = new Set();
  const fallback = queue.counters?.[0]?._id?.toString?.();
  for (const row of rows) {
    if (row.servingCounterId) ids.add(row.servingCounterId.toString());
    else if (fallback) ids.add(fallback);
  }
  return ids;
}

/**
 * Call the head (or selected) waiting entry to a counter.
 * One serving entry is allowed per counter (one total when the queue has a single counter).
 */
export async function callWaitingEntry(queue, { entryId, counterId } = {}) {
  ensureDefaultCounters(queue);
  const busy = await busyCounterIds(queue);
  const target = resolveTargetCounter(queue, { counterId, busyIds: busy });
  if (!target.ok) return target;
  if (busy.has(target.counter._id.toString())) {
    return {
      ok: false,
      status: 409,
      error:
        queue.counters.length <= 1
          ? "Someone is already being called. Serve or skip them first."
          : "That counter is already calling someone. Serve or skip them first.",
    };
  }

  const now = clockNow();
  const window = await resolveNoShowWindow(queue);
  const deadline = new Date(now.getTime() + window.minutes * 60_000);

  const claimed = await claimNextWaiting(queue, {
    entryId,
    update: {
      $set: {
        status: "serving",
        calledAt: now,
        servingDeadlineAt: deadline,
        servingPausedRemainingMs: null,
        arrivedAt: null,
        servingCounterId: target.counter._id,
        noShowWindowMinutes: window.minutes,
        noShowWindowMode: window.mode,
      },
    },
  });
  if (!claimed.ok) return claimed;
  const entry = claimed.entry;

  setCounterNowServing(queue, target.counter, entry.tokenNumber);
  await autoPrepareIfClosedEmpty(queue);
  await queue.save();
  emitQueueChanged(queue._id, "call");
  return { ok: true, entry, queue, counter: target.counter };
}

/**
 * Serve or skip the called entry if one exists, otherwise the next (or selected)
 * waiting entry. Immediate serve of a waiting person still skips the call step.
 */
export async function advanceLineEntry(queue, { entryId, counterId } = {}, terminalStatus) {
  ensureDefaultCounters(queue);
  const clear = {
    $set: {
      status: terminalStatus,
      returning: false,
      ...clearServingTimer(),
      ...(terminalStatus === "skipped" ? { skippedAt: clockNow() } : {}),
      ...(terminalStatus === "served" ? { servedAt: clockNow() } : {}),
    },
  };

  if (!entryId) {
    const servingFilter = { queue: queue._id, status: "serving" };
    if (counterId && mongoose.isValidObjectId(counterId)) {
      servingFilter.servingCounterId = counterId;
    }
    const serving = await QueueEntry.findOneAndUpdate(servingFilter, clear, {
      returnDocument: "after",
    });
    if (serving) {
      if (terminalStatus === "served") applyServedFairness(queue, serving);
      const counter =
        findCounterForEntry(queue, serving) ||
        (counterId ? null : queue.counters[0]);
      completeCounterTurn(queue, counter, serving.tokenNumber, { served: terminalStatus === "served" });
      await autoPrepareIfClosedEmpty(queue);
      await queue.save();
      emitQueueChanged(queue._id, terminalStatus);
      return { ok: true, entry: serving, queue, counter };
    }
  }

  const claimed = await claimNextWaiting(queue, {
    entryId,
    update: clear,
    extraStatuses: entryId ? ["serving"] : [],
  });
  if (!claimed.ok) return claimed;
  const entry = claimed.entry;

  let counter = findCounterForEntry(queue, entry);
  if (!counter) {
    const busy = await busyCounterIds(queue);
    // The entry we just completed may still be in busy if we didn't clear serving yet;
    // it is already terminal, so exclude it.
    if (entry.servingCounterId) busy.delete(entry.servingCounterId.toString());
    const target = resolveTargetCounter(queue, { counterId, busyIds: busy });
    if (target.ok) counter = target.counter;
  }
  if (counter && !entry.servingCounterId) {
    entry.servingCounterId = counter._id;
    await entry.save();
  }
  if (terminalStatus === "served") applyServedFairness(queue, entry);
  completeCounterTurn(queue, counter, entry.tokenNumber, { served: terminalStatus === "served" });
  await autoPrepareIfClosedEmpty(queue);
  await queue.save();
  emitQueueChanged(queue._id, terminalStatus);
  return { ok: true, entry, queue, counter };
}

function findCounterForEntry(queue, entry) {
  if (!entry?.servingCounterId) return null;
  return queue.counters.find((row) => row._id.toString() === entry.servingCounterId.toString()) || null;
}

/**
 * Freeze called deadlines while the queue is paused.
 */
export async function freezeServingDeadlines(queueId, at = clockNow()) {
  const entries = await QueueEntry.find({
    queue: queueId,
    status: "serving",
    servingDeadlineAt: { $ne: null },
  });
  for (const entry of entries) {
    const remaining = Math.max(0, new Date(entry.servingDeadlineAt).getTime() - at.getTime());
    entry.servingPausedRemainingMs = remaining;
    entry.servingDeadlineAt = null;
    await entry.save();
  }
  return entries.length;
}

/**
 * Restart called deadlines from the frozen remainder when the queue resumes.
 */
export async function resumeServingDeadlines(queueId, at = clockNow()) {
  const entries = await QueueEntry.find({
    queue: queueId,
    status: "serving",
    servingPausedRemainingMs: { $ne: null },
  });
  for (const entry of entries) {
    entry.servingDeadlineAt = new Date(at.getTime() + Number(entry.servingPausedRemainingMs));
    entry.servingPausedRemainingMs = null;
    await entry.save();
  }
  return entries.length;
}

/**
 * Auto-skip called entries whose deadline has passed. Skips paused queues.
 * @param {{ queueId?: string }} [options]
 * @returns {Promise<number>} how many entries were skipped
 */
export async function expireNoShowCalls({ queueId } = {}) {
  const instant = clockNow();
  const filter = {
    status: "serving",
    servingDeadlineAt: { $ne: null, $lte: instant },
  };
  if (queueId) filter.queue = queueId;

  const expired = await QueueEntry.find(filter);
  if (expired.length === 0) return 0;

  const queueIds = [...new Set(expired.map((row) => row.queue.toString()))];
  const queues = await Queue.find({ _id: { $in: queueIds } });
  const openIds = new Set(
    queues.filter((queue) => queue.status !== "paused").map((queue) => queue._id.toString())
  );

  let skipped = 0;
  for (const row of expired) {
    if (!openIds.has(row.queue.toString())) continue;
    const claimed = await QueueEntry.findOneAndUpdate(
      {
        _id: row._id,
        status: "serving",
        servingDeadlineAt: { $ne: null, $lte: instant },
      },
      { $set: { status: "skipped", skippedAt: instant, returning: false, ...clearServingTimer() } },
      { returnDocument: "after" }
    );
    if (!claimed) continue;
    const queue = queues.find((row) => row._id.toString() === claimed.queue.toString());
    if (queue) {
      ensureDefaultCounters(queue);
      completeCounterTurn(queue, findCounterForEntry(queue, claimed), claimed.tokenNumber, {
        served: false,
      });
      await queue.save();
    }
    skipped += 1;
    emitQueueChanged(claimed.queue, "skip");
  }
  return skipped;
}

/**
 * Called student taps "I'm here": flag presence and stop the no-show auto-skip
 * by clearing the deadline (and any frozen remainder). Staff can still serve
 * or skip manually. Idempotent if they already checked in.
 */
export async function acknowledgeArrival(queue, entry, at = clockNow()) {
  if (!entry || entry.status !== "serving") {
    return {
      ok: false,
      status: 409,
      error: "You can check in only when you are being called.",
    };
  }
  if (entry.arrivedAt) {
    return { ok: true, already: true, entry };
  }
  entry.arrivedAt = at;
  entry.servingDeadlineAt = null;
  entry.servingPausedRemainingMs = null;
  await entry.save();
  emitQueueChanged(queue._id, "here");
  return { ok: true, already: false, entry };
}
