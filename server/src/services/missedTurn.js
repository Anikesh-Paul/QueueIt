/**
 * Missed-turn recovery: a skipped (no-show) entry may rejoin once,
 * within a per-queue window, N places behind the current serving point.
 */
import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import { rejectIfQueueFull } from "./capacity.js";
import { emitQueueChanged } from "./realtime.js";

export const DEFAULT_RECOVERY_MINUTES = 15;
export const RECOVERY_MINUTES_MIN = 1;
export const RECOVERY_MINUTES_MAX = 60;
export const DEFAULT_RECOVERY_PLACES = 2;
export const RECOVERY_PLACES_MIN = 1;
export const RECOVERY_PLACES_MAX = 20;
export const WAIT_ORDER_SCALE = 1000;

export function waitSortKey(entry) {
  const raw = entry?.waitOrder;
  if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
  const token = Number(entry?.tokenNumber);
  return Number.isFinite(token) ? token * WAIT_ORDER_SCALE : 0;
}

export function compareWaiters(a, b) {
  const ka = waitSortKey(a);
  const kb = waitSortKey(b);
  if (ka !== kb) return ka - kb;
  const ta = Number(a.tokenNumber) || 0;
  const tb = Number(b.tokenNumber) || 0;
  if (ta !== tb) return ta - tb;
  return String(a._id || "").localeCompare(String(b._id || ""));
}

export function resolveRecoveryMinutes(queue) {
  const value = Number(queue?.recoveryMinutes);
  if (Number.isInteger(value) && value >= RECOVERY_MINUTES_MIN) {
    return Math.min(RECOVERY_MINUTES_MAX, value);
  }
  return DEFAULT_RECOVERY_MINUTES;
}

export function resolveRecoveryPlaces(queue) {
  const value = Number(queue?.recoveryPlaces);
  if (Number.isInteger(value) && value >= RECOVERY_PLACES_MIN) {
    return Math.min(RECOVERY_PLACES_MAX, value);
  }
  return DEFAULT_RECOVERY_PLACES;
}

export function recoveryDeadline(entry, queue) {
  if (!entry?.skippedAt) return null;
  const start = entry.skippedAt instanceof Date ? entry.skippedAt : new Date(entry.skippedAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + resolveRecoveryMinutes(queue) * 60_000);
}

export function isRecoverable(entry, queue, now = clockNow()) {
  if (!entry || entry.status !== "skipped") return false;
  if ((entry.recoveryCount || 0) >= 1) return false;
  const until = recoveryDeadline(entry, queue);
  if (!until) return false;
  return now.getTime() < until.getTime();
}

function identityFilter(identity = {}) {
  if (identity.user) return { user: identity.user };
  if (identity.guest) return { guest: identity.guest };
  return null;
}

export async function findRecoverableEntry(queue, identity, now = clockNow()) {
  const ident = identityFilter(identity);
  if (!ident || !queue) return null;
  const entry = await QueueEntry.findOne({
    queue: queue._id,
    status: "skipped",
    ...ident,
  }).sort({ skippedAt: -1, updatedAt: -1 });
  if (!isRecoverable(entry, queue, now)) return null;
  return entry;
}

export async function findJoinerSkippedOrActive(queueId, identity) {
  const ident = identityFilter(identity);
  if (!ident) return null;
  return QueueEntry.findOne({
    queue: queueId,
    ...ident,
    status: { $in: ["waiting", "serving", "skipped"] },
  }).sort({ updatedAt: -1 });
}

export async function listWaitingSorted(queueId) {
  const waiters = await QueueEntry.find({ queue: queueId, status: "waiting" }).select(
    "tokenNumber waitOrder"
  );
  return waiters.sort(compareWaiters);
}

/**
 * Next waiter id in fair wait-order (falls back to token * 1000).
 */
export async function findNextWaitingId(queueId) {
  const rows = await QueueEntry.aggregate([
    { $match: { queue: queueId, status: "waiting" } },
    {
      $addFields: {
        sortKey: { $ifNull: ["$waitOrder", { $multiply: ["$tokenNumber", WAIT_ORDER_SCALE] }] },
      },
    },
    { $sort: { sortKey: 1, tokenNumber: 1 } },
    { $limit: 1 },
    { $project: { _id: 1 } },
  ]);
  return rows[0]?._id ?? null;
}

/**
 * Wait-order that sits N places behind the current serving point
 * without jumping anyone already within those N places.
 */
export async function computeRecoverWaitOrder(queueId, places) {
  const n = Math.max(RECOVERY_PLACES_MIN, Math.trunc(places) || DEFAULT_RECOVERY_PLACES);
  const waiters = await listWaitingSorted(queueId);
  if (waiters.length === 0) {
    const serving = await QueueEntry.findOne({ queue: queueId, status: "serving" }).select(
      "tokenNumber waitOrder"
    );
    return serving ? waitSortKey(serving) + WAIT_ORDER_SCALE : WAIT_ORDER_SCALE;
  }
  if (waiters.length <= n) {
    return waitSortKey(waiters[waiters.length - 1]) + WAIT_ORDER_SCALE;
  }
  const before = waitSortKey(waiters[n - 1]);
  const after = waitSortKey(waiters[n]);
  if (after > before) return (before + after) / 2;
  return before + WAIT_ORDER_SCALE / 2;
}

async function classifyRecoveryBlock(queue, identity, now) {
  const ident = identityFilter(identity);
  if (!ident) return { status: 404, error: "Not a missed turn" };
  const latest = await QueueEntry.findOne({
    queue: queue._id,
    ...ident,
  }).sort({ updatedAt: -1 });
  if (!latest) return { status: 404, error: "Not a missed turn" };
  if (latest.status === "left") {
    return { status: 409, error: "You left this line and cannot rejoin" };
  }
  if (latest.status === "waiting" || latest.status === "serving") {
    return { status: 409, error: "Already in this queue" };
  }
  if (latest.status !== "skipped") {
    return { status: 409, error: "Not a missed turn" };
  }
  if ((latest.recoveryCount || 0) >= 1) {
    return { status: 409, error: "You already used your rejoin for this visit" };
  }
  if (!isRecoverable(latest, queue, now)) {
    return { status: 409, error: "You can no longer rejoin this turn" };
  }
  return { status: 409, error: "You can no longer rejoin this turn" };
}

/**
 * Atomically reopen a skipped entry as waiting, inserted fairly.
 */
export async function recoverMissedTurn({ queue, identity, now = clockNow() }) {
  const ident = identityFilter(identity);
  if (!ident) return { ok: false, status: 404, error: "Not a missed turn" };

  const eligible = await findRecoverableEntry(queue, identity, now);
  if (!eligible) {
    const blocked = await classifyRecoveryBlock(queue, identity, now);
    return { ok: false, ...blocked };
  }

  const full = await rejectIfQueueFull(queue);
  if (full) return { ok: false, status: 409, error: full.error };

  const places = resolveRecoveryPlaces(queue);
  const waitOrder = await computeRecoverWaitOrder(queue._id, places);
  const until = recoveryDeadline(eligible, queue);

  const entry = await QueueEntry.findOneAndUpdate(
    {
      _id: eligible._id,
      queue: queue._id,
      status: "skipped",
      recoveryCount: { $lt: 1 },
      skippedAt: { $ne: null, $gt: new Date(now.getTime() - resolveRecoveryMinutes(queue) * 60_000) },
      ...ident,
    },
    {
      $set: {
        status: "waiting",
        returning: true,
        recoveredAt: now,
        waitOrder,
        calledAt: null,
        servingDeadlineAt: null,
        servingPausedRemainingMs: null,
        arrivedAt: null,
        servingCounterId: null,
      },
      $inc: { recoveryCount: 1 },
    },
    { returnDocument: "after" }
  );

  if (!entry) {
    const blocked = await classifyRecoveryBlock(queue, identity, clockNow());
    return { ok: false, ...blocked };
  }

  emitQueueChanged(queue._id, "join");
  return { ok: true, entry, queue, recoverUntil: until };
}

