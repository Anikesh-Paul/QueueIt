import { QueueEntry, ACTIVE_ENTRY_STATUSES } from "../models/QueueEntry.js";
import { sessionFieldsForJson } from "./queueSession.js";
import { signArrivalPass } from "./arrivalPass.js";
import { resolveEtaServicePace } from "./recentServicePace.js";
import { servingFieldsForJson } from "./servingDeadline.js";

/**
 * Live position among active waiters (1 = front of waiting line).
 * Waiting entries ordered by tokenNumber ascending.
 */
export async function computePosition(queueId, tokenNumber, entryStatus = "waiting") {
  if (entryStatus === "serving") return 0;
  const ahead = await QueueEntry.countDocuments({
    queue: queueId,
    status: "waiting",
    tokenNumber: { $lt: tokenNumber },
  });
  return ahead + 1;
}

/**
 * Product ETA rule: position × service pace (minutes).
 * Pace is the recent inter-serve average when the sample is thick enough,
 * otherwise the queue's configured averageServiceTime.
 */
export function computeEtaMinutes(position, servicePaceMinutes) {
  return position * servicePaceMinutes;
}

/**
 * Build the public join/status payload for an active entry + queue.
 */
export async function buildStatusPayload(queue, entry) {
  const position = await computePosition(queue._id, entry.tokenNumber, entry.status);
  const averageServiceTime = queue.averageServiceTime;
  const { pace: etaServiceTime, source: etaPaceSource } = await resolveEtaServicePace(queue);
  const etaMinutes = computeEtaMinutes(position, etaServiceTime);

  return {
    tokenNumber: entry.tokenNumber,
    position,
    etaMinutes,
    nowServing: queue.nowServing ?? null,
    averageServiceTime,
    etaServiceTime,
    etaPaceSource,
    status: entry.status,
    arrivalPass: signArrivalPass(queue._id, entry.tokenNumber),
    ...servingFieldsForJson(entry, { paused: queue.status === "paused" }),
    queue: {
      id: queue._id.toString(),
      name: queue.name,
      status: queue.status,
      acceptingTokens: queue.acceptingTokens !== false,
      ...sessionFieldsForJson(queue),
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

/**
 * Find a Guest's active membership in a queue (waiting or serving).
 * Peer fairness: one active membership per queue, same as User.
 */
export async function findActiveGuestEntry(queueId, guestId) {
  return QueueEntry.findOne({
    queue: queueId,
    guest: guestId,
    status: { $in: ACTIVE_ENTRY_STATUSES },
  });
}

/**
 * Map entry status to a user-facing history outcome.
 * Active membership (waiting/serving) surfaces as "joined".
 */
export function outcomeFromStatus(status) {
  if (status === "waiting" || status === "serving") return "joined";
  return status;
}

/**
 * Public history row for one QueueEntry (populated queue optional).
 */
export function toHistoryEvent(entry) {
  const queueDoc = entry.queue;
  const queue =
    queueDoc && typeof queueDoc === "object" && queueDoc.name
      ? { id: queueDoc._id.toString(), name: queueDoc.name }
      : {
          id: (queueDoc?._id ?? queueDoc)?.toString?.() ?? String(queueDoc),
          name: null,
        };

  return {
    id: entry._id.toString(),
    outcome: outcomeFromStatus(entry.status),
    status: entry.status,
    tokenNumber: entry.tokenNumber,
    queue,
    joinedAt: entry.createdAt?.toISOString?.() ?? entry.createdAt,
    updatedAt: entry.updatedAt?.toISOString?.() ?? entry.updatedAt,
  };
}
