/**
 * Optional waiting-list caps (maxWaiting). Serving entries count toward the cap
 * because they still occupy a place in line until they are served or skipped.
 */

import { QueueEntry, ACTIVE_ENTRY_STATUSES } from "../models/QueueEntry.js";

export const MAX_WAITING_LIMIT = 500;
export const QUEUE_FULL_ERROR = "This queue is full";
export const CAP_BELOW_OCCUPANCY_ERROR =
  "Cap can't be below the people already in line";

/**
 * Parse an admin maxWaiting value.
 * Omitted (undefined) leaves the current cap alone; null/"" clears it.
 * @param {unknown} raw
 * @returns {{ omitted: true } | { value: number | null } | { error: string }}
 */
export function normalizeMaxWaiting(raw) {
  if (raw === undefined) return { omitted: true };
  if (raw === null || raw === "") return { value: null };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_WAITING_LIMIT) {
    return {
      error: `maxWaiting must be an integer from 1 to ${MAX_WAITING_LIMIT}, or empty to clear`,
    };
  }
  return { value };
}

export function maxWaitingOf(queue) {
  const value = queue?.maxWaiting;
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}

export async function countActiveInQueue(queueId) {
  return QueueEntry.countDocuments({
    queue: queueId,
    status: { $in: ACTIVE_ENTRY_STATUSES },
  });
}

/**
 * Reject setting a numeric cap below current waiting+serving occupancy.
 * Clearing the cap (null) is always allowed. Does not evict anyone.
 * @returns {{ error: string, waitingCount: number, maxWaiting: number } | null}
 */
export async function rejectIfCapBelowOccupancy(queue, capValue) {
  if (capValue == null) return null;
  const waitingCount = await countActiveInQueue(queue._id);
  if (waitingCount <= capValue) return null;
  return {
    error:
      `Cap can't be below the ${waitingCount} people already in line. ` +
      "Serve or skip some first, or leave the cap empty.",
    waitingCount,
    maxWaiting: capValue,
  };
}

export async function occupancyByQueueIds(queueIds) {
  if (!queueIds.length) return new Map();
  const rows = await QueueEntry.aggregate([
    { $match: { queue: { $in: queueIds }, status: { $in: ACTIVE_ENTRY_STATUSES } } },
    { $group: { _id: "$queue", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

export function withOccupancy(queue, waitingCount = 0) {
  const json = typeof queue.toPublicJSON === "function" ? queue.toPublicJSON() : { ...queue };
  const maxWaiting = json.maxWaiting ?? maxWaitingOf(queue);
  const count = Number(waitingCount) || 0;
  return {
    ...json,
    maxWaiting: maxWaiting ?? null,
    waitingCount: count,
    full: maxWaiting != null && count >= maxWaiting,
  };
}

export async function queuesWithOccupancy(queues) {
  const occupancy = await occupancyByQueueIds(queues.map((queue) => queue._id));
  return queues.map((queue) => withOccupancy(queue, occupancy.get(String(queue._id)) || 0));
}

export function fullPayload(queue, waitingCount) {
  return {
    error: QUEUE_FULL_ERROR,
    maxWaiting: maxWaitingOf(queue),
    waitingCount,
  };
}

/** Pre-insert gate so we usually avoid minting a token when the line is already full. */
export async function rejectIfQueueFull(queue) {
  const maxWaiting = maxWaitingOf(queue);
  if (maxWaiting == null) return null;
  const waitingCount = await countActiveInQueue(queue._id);
  if (waitingCount >= maxWaiting) return fullPayload(queue, waitingCount);
  return null;
}

/**
 * After inserting an entry, drop it if this token would exceed the cap.
 * Concurrent joiners are ordered by tokenNumber so the cap is never exceeded.
 * @returns {object | null} 409 payload when the entry was released
 */
export async function releaseEntryIfOverCapacity(queue, entry) {
  const maxWaiting = maxWaitingOf(queue);
  if (maxWaiting == null) return null;
  const ahead = await QueueEntry.countDocuments({
    queue: queue._id,
    status: { $in: ACTIVE_ENTRY_STATUSES },
    tokenNumber: { $lt: entry.tokenNumber },
  });
  if (ahead < maxWaiting) return null;
  await QueueEntry.deleteOne({
    _id: entry._id,
    status: { $in: ACTIVE_ENTRY_STATUSES },
  });
  return fullPayload(queue, maxWaiting);
}
