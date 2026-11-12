import { Queue } from "../models/Queue.js";
import { QueueEntry, ACTIVE_ENTRY_STATUSES } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import { leaveFieldsForJson } from "./leaveAlert.js";
import { sessionFieldsForJson } from "./queueSession.js";
import { signArrivalPass } from "./arrivalPass.js";
import { buildEstimate, estimateBasisJson, resolveSmartPace } from "./smartEstimate.js";
import { servingFieldsForJson } from "./servingDeadline.js";
import { countersForJson, ensureDefaultCounters, reconcileCounterServing, staffingFactor } from "./counters.js";
import { isRecoverable, recoveryDeadline } from "./missedTurn.js";
import { positionInFairOrder, priorityFieldsForJson } from "./priorityLane.js";

/**
 * Live position among active waiters (1 = front of the fair call order).
 */
export async function computePosition(queueId, tokenOrEntry, entryStatus = "waiting", queue = null) {
  const entry =
    tokenOrEntry && typeof tokenOrEntry === "object"
      ? tokenOrEntry
      : { tokenNumber: tokenOrEntry, status: entryStatus };
  const status = entry.status || entryStatus;
  if (status === "serving") return 0;
  if (status === "skipped" || status === "left" || status === "served") return null;
  const waiters = await QueueEntry.find({ queue: queueId, status: "waiting" }).select(
    "tokenNumber waitOrder priority appointmentAt"
  );
  const fairness =
    queue || (await Queue.findById(queueId).select("priorityEveryK regularServesSincePriority walkInsSinceAppointment"));
  return positionInFairOrder(waiters, entry, fairness) ?? 1;
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
  const servingEntries = await QueueEntry.find({
    queue: queue._id,
    status: "serving",
  }).select("tokenNumber servingCounterId status");
  const missingCounters = ensureDefaultCounters(queue);
  const reconciled = reconcileCounterServing(queue, servingEntries);
  if (missingCounters || reconciled) await queue.save();
  const position = await computePosition(queue._id, entry, entry.status, queue);
  const averageServiceTime = queue.averageServiceTime;
  const smart = await resolveSmartPace(queue);
  const etaPaceSource = smart.source;
  const staffing = staffingFactor(queue);
  // Fewer counters open → each place in line takes longer.
  const estimate = buildEstimate(smart, { position, staffingFactor: staffing.factor });
  const etaServiceTime = estimate.pace;
  let etaMinutes = estimate.etaMinutes;
  let etaRange = estimate.range;
  // A booking is not called before its slot starts.
  if (etaMinutes != null && entry.appointmentAt) {
    const untilSlot = Math.ceil((new Date(entry.appointmentAt).getTime() - clockNow().getTime()) / 60_000);
    if (untilSlot > etaMinutes) {
      etaMinutes = untilSlot;
      etaRange = { low: untilSlot, high: untilSlot + Math.ceil(etaServiceTime), confidence: "high" };
    }
  }
  const recoverable = isRecoverable(entry, queue);
  const until = recoverable ? recoveryDeadline(entry, queue) : null;

  return {
    tokenNumber: entry.tokenNumber,
    position,
    etaMinutes,
    nowServing: queue.nowServing ?? null,
    counters: countersForJson(queue),
    averageServiceTime,
    etaServiceTime,
    etaPaceSource,
    etaRange: etaRange ? { low: etaRange.low, high: etaRange.high } : null,
    etaConfidence: etaRange ? etaRange.confidence : null,
    etaBasis: estimateBasisJson(smart),
    countersOpen: staffing.open,
    countersTotal: staffing.total,
    status: entry.status,
    arrivalPass: signArrivalPass(queue._id, entry.tokenNumber),
    missedTurn: entry.status === "skipped",
    canRecover: recoverable,
    recoverUntil: until ? until.toISOString() : null,
    returning: Boolean(entry.returning),
    appointmentAt: entry.appointmentAt ? new Date(entry.appointmentAt).toISOString() : null,
    ...leaveFieldsForJson(entry, { etaMinutes, paused: queue.status === "paused" }),
    ...priorityFieldsForJson(entry),
    ...servingFieldsForJson(entry, { paused: queue.status === "paused", queue }),
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
