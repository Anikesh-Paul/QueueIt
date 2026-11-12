import mongoose from "mongoose";
import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import { compareWaiters } from "./missedTurn.js";

export const PRIORITY_REASONS = ["accessibility", "pregnancy", "medical", "other"];
export const PRIORITY_REQUEST_STATUSES = ["pending", "approved", "rejected"];
export const DEFAULT_PRIORITY_EVERY_K = 3;
export const PRIORITY_EVERY_K_MIN = 1;
export const PRIORITY_EVERY_K_MAX = 10;

export function resolvePriorityEveryK(queue) {
  const value = Number(queue?.priorityEveryK);
  if (Number.isInteger(value) && value >= PRIORITY_EVERY_K_MIN && value <= PRIORITY_EVERY_K_MAX) {
    return value;
  }
  return DEFAULT_PRIORITY_EVERY_K;
}

export function regularServesSincePriorityOf(queue) {
  const k = resolvePriorityEveryK(queue);
  const value = Number(queue?.regularServesSincePriority);
  if (Number.isInteger(value) && value >= 0) return Math.min(k - 1, value);
  return Math.max(0, k - 1);
}

export function canTakePriority(queue, { regularWaiting = null } = {}) {
  const k = resolvePriorityEveryK(queue);
  if (k <= 1) return true;
  if (regularWaiting === 0) return true;
  return regularServesSincePriorityOf(queue) >= k - 1;
}

export function applyServedFairness(queue, entry) {
  const k = resolvePriorityEveryK(queue);
  if (entry?.priority) {
    queue.regularServesSincePriority = 0;
  } else {
    queue.regularServesSincePriority = Math.min(k - 1, regularServesSincePriorityOf(queue) + 1);
    // Booked and walk-in turns alternate while both are waiting.
    queue.walkInsSinceAppointment = entry?.appointmentAt ? 0 : 1;
  }
  return queue.regularServesSincePriority;
}

/** True when the next serve may go to a due booking (no two booked turns in a row while walk-ins wait). */
export function canTakeAppointment(queue, { walkInsWaiting = null } = {}) {
  if (walkInsWaiting === 0) return true;
  const value = Number(queue?.walkInsSinceAppointment);
  return !Number.isFinite(value) || value >= 1;
}

function isDueAppointment(entry, at) {
  if (!entry?.appointmentAt) return false;
  return new Date(entry.appointmentAt).getTime() <= at.getTime();
}

function compareAppointments(a, b) {
  const ta = new Date(a.appointmentAt).getTime();
  const tb = new Date(b.appointmentAt).getTime();
  if (ta !== tb) return ta - tb;
  return compareWaiters(a, b);
}

/**
 * Fair call order for waiting entries.
 * - Priority occupies at most every Kth serve, unless only priority waiters remain.
 * - A checked-in booking whose slot has started goes ahead of walk-ins, but booked
 *   turns never run back to back while walk-ins wait.
 * - Bookings checked in early wait until their slot unless nobody else is waiting.
 * Relative order inside a lane is waitOrder (bookings: slot time).
 */
export function fairCallOrder(waiters, queue, at = clockNow()) {
  const priority = [];
  const booked = [];
  const regular = [];
  const early = [];
  for (const entry of waiters || []) {
    if (entry?.appointmentAt && !isDueAppointment(entry, at)) early.push(entry);
    else if (entry?.priority) priority.push(entry);
    else if (entry?.appointmentAt) booked.push(entry);
    else regular.push(entry);
  }
  priority.sort(compareWaiters);
  booked.sort(compareAppointments);
  regular.sort(compareWaiters);
  early.sort(compareAppointments);
  const k = resolvePriorityEveryK(queue);
  let since = regularServesSincePriorityOf(queue);
  let walkIns = canTakeAppointment(queue) ? 1 : 0;
  const out = [];
  let i = 0;
  let b = 0;
  let j = 0;
  while (i < priority.length || b < booked.length || j < regular.length) {
    const nonPriorityLeft = b < booked.length || j < regular.length;
    const canP = k <= 1 || since >= k - 1 || !nonPriorityLeft;
    if (canP && i < priority.length) {
      out.push(priority[i++]);
      since = 0;
      continue;
    }
    const canB = walkIns >= 1 || j >= regular.length;
    if (canB && b < booked.length) {
      out.push(booked[b++]);
      walkIns = 0;
    } else if (j < regular.length) {
      out.push(regular[j++]);
      walkIns = 1;
    } else if (b < booked.length) {
      out.push(booked[b++]);
      walkIns = 0;
    } else {
      out.push(priority[i++]);
      since = 0;
      continue;
    }
    since = Math.min(k - 1, since + 1);
  }
  return [...out, ...early];
}

export function positionInFairOrder(waiters, entry, queue, at = clockNow()) {
  if (!entry) return null;
  const ordered = fairCallOrder(waiters, queue, at);
  const id = entry._id?.toString?.() ?? entry.id;
  const token = Number(entry.tokenNumber);
  const index = ordered.findIndex((row) => {
    if (id && row._id?.toString?.() === id) return true;
    return Number(row.tokenNumber) === token;
  });
  return index === -1 ? null : index + 1;
}

export function cleanPriorityReason(raw) {
  if (raw == null || raw === "") return { error: "Choose a priority reason" };
  const value = String(raw).trim().toLowerCase();
  if (!PRIORITY_REASONS.includes(value)) {
    return { error: "Priority reason must be accessibility, pregnancy, medical, or other" };
  }
  return { value };
}

export function priorityFieldsForJson(entry) {
  const reason = PRIORITY_REASONS.includes(entry?.priorityReason) ? entry.priorityReason : null;
  const requestStatus = PRIORITY_REQUEST_STATUSES.includes(entry?.priorityRequestStatus)
    ? entry.priorityRequestStatus
    : null;
  return {
    priority: Boolean(entry?.priority),
    priorityReason: reason,
    priorityRequestStatus: requestStatus,
  };
}

export async function requestPriority(queue, entry, { reason } = {}) {
  if (!entry || entry.status !== "waiting") {
    return { ok: false, status: 409, error: "Only a waiting place can request priority" };
  }
  if (entry.priority) {
    return { ok: false, status: 409, error: "This place already has priority" };
  }
  if (entry.priorityRequestStatus === "pending") {
    return { ok: false, status: 409, error: "A priority request is already waiting for staff" };
  }
  const cleaned = cleanPriorityReason(reason);
  if (cleaned.error) return { ok: false, status: 400, error: cleaned.error };

  entry.priority = false;
  entry.priorityReason = cleaned.value;
  entry.priorityRequestStatus = "pending";
  entry.priorityRequestedAt = clockNow();
  await entry.save();
  return { ok: true, entry };
}

export async function markPriority(queue, entry, { reason } = {}) {
  if (!entry || !["waiting", "serving"].includes(entry.status)) {
    return { ok: false, status: 409, error: "Only a current place in line can be marked priority" };
  }
  const cleaned = cleanPriorityReason(reason ?? entry.priorityReason);
  if (cleaned.error) return { ok: false, status: 400, error: cleaned.error };
  entry.priority = true;
  entry.priorityReason = cleaned.value;
  entry.priorityRequestStatus = "approved";
  if (!entry.priorityRequestedAt) entry.priorityRequestedAt = clockNow();
  await entry.save();
  return { ok: true, entry };
}

export async function decidePriorityRequest(queue, entry, { approve } = {}) {
  if (!entry || entry.status !== "waiting") {
    return { ok: false, status: 409, error: "Only a waiting request can be decided" };
  }
  if (entry.priorityRequestStatus !== "pending") {
    return { ok: false, status: 409, error: "There is no pending priority request" };
  }
  if (approve) {
    entry.priority = true;
    entry.priorityRequestStatus = "approved";
  } else {
    entry.priority = false;
    entry.priorityRequestStatus = "rejected";
  }
  await entry.save();
  return { ok: true, entry };
}

/**
 * Atomically claim the next (or selected) waiting entry, honouring the fairness cap.
 */
export async function claimNextWaiting(queue, { entryId, update, extraStatuses = [] } = {}) {
  const statuses = ["waiting", ...extraStatuses];
  if (entryId) {
    if (!mongoose.isValidObjectId(entryId)) {
      return { ok: false, status: 404, error: "Waiting entry not found" };
    }
    const preview = await QueueEntry.findById(entryId).select(
      "queue status priority"
    );
    if (!preview || preview.queue.toString() !== queue._id.toString()) {
      return { ok: false, status: 404, error: "Waiting entry not found" };
    }
    if (preview.status === "waiting" && preview.priority) {
      const regularWaiting = await QueueEntry.countDocuments({
        queue: queue._id,
        status: "waiting",
        _id: { $ne: preview._id },
        priority: { $ne: true },
      });
      if (!canTakePriority(queue, { regularWaiting })) {
        return {
          ok: false,
          status: 409,
          error: `Priority is limited to at most every ${resolvePriorityEveryK(queue)} serves so the regular line is not starved.`,
        };
      }
    }
    const entry = await QueueEntry.findOneAndUpdate(
      { _id: entryId, queue: queue._id, status: { $in: statuses } },
      update,
      { returnDocument: "after" }
    );
    if (!entry) return { ok: false, status: 404, error: "Waiting entry not found" };
    return { ok: true, entry };
  }

  const sort = { waitOrder: 1, tokenNumber: 1 };
  const now = clockNow();
  const base = { queue: queue._id, status: "waiting" };
  // Bookings checked in early are not callable until their slot (unless nobody else waits).
  const notEarly = { $or: [{ appointmentAt: null }, { appointmentAt: { $lte: now } }] };
  if (canTakePriority(queue)) {
    const priority = await QueueEntry.findOneAndUpdate(
      { ...base, ...notEarly, priority: true },
      update,
      { sort, returnDocument: "after" }
    );
    if (priority) return { ok: true, entry: priority };
  }
  if (canTakeAppointment(queue)) {
    const booked = await QueueEntry.findOneAndUpdate(
      { ...base, priority: { $ne: true }, appointmentAt: { $ne: null, $lte: now } },
      update,
      { sort: { appointmentAt: 1, ...sort }, returnDocument: "after" }
    );
    if (booked) return { ok: true, entry: booked };
  }
  const regular = await QueueEntry.findOneAndUpdate(
    { ...base, priority: { $ne: true }, appointmentAt: null },
    update,
    { sort, returnDocument: "after" }
  );
  if (regular) return { ok: true, entry: regular };
  const due = await QueueEntry.findOneAndUpdate({ ...base, ...notEarly }, update, {
    sort: { priority: -1, appointmentAt: 1, ...sort },
    returnDocument: "after",
  });
  if (due) return { ok: true, entry: due };
  const fallback = await QueueEntry.findOneAndUpdate(base, update, {
    sort: { appointmentAt: 1, ...sort },
    returnDocument: "after",
  });
  if (!fallback) return { ok: false, status: 404, error: "No one waiting" };
  return { ok: true, entry: fallback };
}
