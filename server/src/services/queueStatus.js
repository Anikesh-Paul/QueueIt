import { QueueEntry, ACTIVE_ENTRY_STATUSES } from "../models/QueueEntry.js";

/**
 * Live position among active waiters (1 = front of waiting line).
 * Waiting entries ordered by tokenNumber ascending.
 */
export async function computePosition(queueId, tokenNumber) {
  const ahead = await QueueEntry.countDocuments({
    queue: queueId,
    status: "waiting",
    tokenNumber: { $lt: tokenNumber },
  });
  return ahead + 1;
}

/**
 * Product ETA rule: position × averageServiceTime (minutes).
 */
export function computeEtaMinutes(position, averageServiceTime) {
  return position * averageServiceTime;
}

/**
 * Build the public join/status payload for an active entry + queue.
 */
export async function buildStatusPayload(queue, entry) {
  const position = await computePosition(queue._id, entry.tokenNumber);
  const averageServiceTime = queue.averageServiceTime;
  const etaMinutes = computeEtaMinutes(position, averageServiceTime);

  return {
    tokenNumber: entry.tokenNumber,
    position,
    etaMinutes,
    nowServing: queue.nowServing ?? null,
    averageServiceTime,
    status: entry.status,
    queue: {
      id: queue._id.toString(),
      name: queue.name,
      status: queue.status,
    },
  };
}

/**
 * Find the user's active membership in a queue (waiting or serving).
 */
export async function findActiveEntry(queueId, userId) {
  return QueueEntry.findOne({
    queue: queueId,
    user: userId,
    status: { $in: ACTIVE_ENTRY_STATUSES },
  });
}
