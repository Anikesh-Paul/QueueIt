import { Router } from "express";
import mongoose from "mongoose";
import { attachJoiner, requireJoiner, GUEST_CREDENTIAL_HEADER } from "../middleware/auth.js";
import { Guest } from "../models/Guest.js";
import { Queue } from "../models/Queue.js";
import { QueueEntry, ACTIVE_ENTRY_STATUSES, isDuplicateKeyError } from "../models/QueueEntry.js";
import {
  buildStatusPayload,
  findActiveEntry,
  findActiveGuestEntry,
  toHistoryEvent,
} from "../services/queueStatus.js";
import { emitQueueChanged } from "../services/realtime.js";
import { ensureQueueSessionState } from "../services/queueSession.js";
import { acknowledgeArrival, expireNoShowCalls } from "../services/servingDeadline.js";
import { findRecoverableEntry, isRecoverable, recoverMissedTurn, recoveryDeadline } from "../services/missedTurn.js";
import { requestPriority } from "../services/priorityLane.js";
import { recordAdminAudit } from "../services/adminAudit.js";
import { occupancyByQueueIds, queuesWithOccupancy, rejectIfQueueFull, releaseEntryIfOverCapacity } from "../services/capacity.js";
import { attachEquivalentSuggestions } from "../services/equivalentQueues.js";
import { attachQuietHints } from "../services/bestTime.js";
import { toBoardJSON } from "../services/queueBoard.js";
import { ensureDefaultCounters, reconcileCounterServing } from "../services/counters.js";
import { Appointment } from "../models/Appointment.js";
import {
  BOOKING_ERRORS,
  bookSlot,
  cancelBooking,
  checkInAppointment,
  expireMissedAppointments,
  listMyAppointments,
  listSlots,
  toAppointmentJSON,
} from "../services/appointments.js";
import { checkExistingGuest, checkGuestMint, GUEST_JOIN_DISABLED, networkHashOf } from "../services/guestLimits.js";
// Register Venue model so Queue.populate("venue") resolves at runtime.
import "../models/Venue.js";

/** Reconcile live vs last-served counters before the public catalog is serialized. */
async function reconcileCatalogServing(queues) {
  if (!queues.length) return;
  const serving = await QueueEntry.find({
    queue: { $in: queues.map((q) => q._id) },
    status: "serving",
  }).select("tokenNumber servingCounterId status queue");
  const byQueue = new Map();
  for (const entry of serving) {
    const id = String(entry.queue);
    const list = byQueue.get(id);
    if (list) list.push(entry);
    else byQueue.set(id, [entry]);
  }
  for (const queue of queues) {
    const missing = ensureDefaultCounters(queue);
    const reconciled = reconcileCounterServing(queue, byQueue.get(String(queue._id)) || []);
    if (missing || reconciled) await queue.save();
  }
}

const router = Router();

/**
 * GET /api/queues — list available queues (seeded catalog).
 * Public: Guests may browse without a credential; JWT optional.
 */
router.get("/", async (_req, res, next) => {
  try {
    // Catalog lists open, paused, and closed (not accepting) queues honestly.
    // status is advancement-only (open|paused); acceptingTokens is orthogonal.
    const queues = await Queue.find({ status: { $in: ["open", "paused"] }, archivedAt: null })
      .populate("venue")
      .sort({ name: 1 })
      .exec();

    for (const q of queues) {
      await ensureQueueSessionState(q);
      await expireNoShowCalls({ queueId: q._id });
    }
    await reconcileCatalogServing(queues);

    return res.status(200).json({
      queues: await attachQuietHints(attachEquivalentSuggestions(await queuesWithOccupancy(queues))),
    });
  } catch (err) {
    return next(err);
  }
});


/**
 * GET /api/queues/:queueId/board — public now-serving board (token numbers only).
 * No auth. Used by the kiosk / display-board route.
 */
router.get("/:queueId/board", async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) {
      return res.status(404).json({ error: "Queue not found" });
    }
    const queue = await Queue.findOne({ _id: queueId, archivedAt: null }).populate("venue");
    if (!queue) {
      return res.status(404).json({ error: "Queue not found" });
    }
    await ensureQueueSessionState(queue);
    await expireNoShowCalls({ queueId: queue._id });
    await reconcileCatalogServing([queue]);
    const occupancy = await occupancyByQueueIds([queue._id]);
    const waitingCount = occupancy.get(String(queue._id)) || 0;
    return res.status(200).json({ queue: toBoardJSON(queue, waitingCount) });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/queues/history — User History or Guest device-local history (newest first).
 * Outcomes: joined (active waiting/serving), left, served, skipped.
 * Registered before /:queueId routes so "history" is not parsed as an id.
 */
export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 50;

function parseHistoryLimit(raw) {
  if (raw == null || raw === "") return HISTORY_DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return HISTORY_DEFAULT_LIMIT;
  return Math.min(n, HISTORY_MAX_LIMIT);
}

/** Cursor is `<updatedAt ISO>_<entry id>` from the last event of the previous page. */
function parseHistoryCursor(raw) {
  if (!raw || typeof raw !== "string") return null;
  const split = raw.trim().lastIndexOf("_");
  if (split <= 0) return null;
  const at = new Date(raw.slice(0, split));
  const id = raw.slice(split + 1);
  if (Number.isNaN(at.getTime()) || !mongoose.isValidObjectId(id)) return null;
  return { at, id };
}

function historyCursorOf(entry) {
  const at = entry.updatedAt?.toISOString?.() ?? new Date(entry.updatedAt).toISOString();
  return `${at}_${entry._id.toString()}`;
}

router.get("/history", attachJoiner, requireJoiner, async (req, res, next) => {
  try {
    const filter = req.user
      ? { user: req.user._id }
      : { guest: req.guest._id };

    const limit = parseHistoryLimit(req.query?.limit);
    const cursor = parseHistoryCursor(req.query?.cursor);
    if (req.query?.cursor && !cursor) {
      return res.status(400).json({ error: "Invalid history cursor" });
    }
    if (cursor) {
      filter.$or = [
        { updatedAt: { $lt: cursor.at } },
        { updatedAt: cursor.at, _id: { $lt: cursor.id } },
      ];
    }

    const entries = await QueueEntry.find(filter)
      .populate("queue")
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const last = page[page.length - 1];

    return res.status(200).json({
      events: page.map((entry) => toHistoryEvent(entry)),
      limit,
      hasMore,
      nextCursor: hasMore && last ? historyCursorOf(last) : null,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/queues/active — every active membership for the current joiner.
 * Registered before /:queueId routes so "active" is not parsed as an id.
 */
router.get("/active", attachJoiner, requireJoiner, async (req, res, next) => {
  try {
    const filter = req.user
      ? { user: req.user._id, status: { $in: ACTIVE_ENTRY_STATUSES } }
      : { guest: req.guest._id, status: { $in: ACTIVE_ENTRY_STATUSES } };

    const entries = await QueueEntry.find(filter)
      .populate("queue")
      .sort({ createdAt: 1 })
      .exec();

    const memberships = [];
    const seen = new Set();
    for (const entry of entries) {
      const queue = entry.queue;
      if (!queue) continue;
      await ensureQueueSessionState(queue);
      await expireNoShowCalls({ queueId: queue._id });
      memberships.push(await buildStatusPayload(queue, entry));
      seen.add(queue._id.toString());
    }

    const skippedFilter = req.user
      ? { user: req.user._id, status: "skipped" }
      : { guest: req.guest._id, status: "skipped" };
    const skipped = await QueueEntry.find(skippedFilter).populate("queue").sort({ skippedAt: -1 });
    for (const entry of skipped) {
      const queue = entry.queue;
      if (!queue || seen.has(queue._id.toString())) continue;
      await ensureQueueSessionState(queue);
      if (!isRecoverable(entry, queue)) continue;
      memberships.push(await buildStatusPayload(queue, entry));
      seen.add(queue._id.toString());
    }

    return res.status(200).json({ memberships });
  } catch (err) {
    return next(err);
  }
});


/**
 * GET /api/queues/appointments/mine — the signed-in user's live bookings.
 * Registered before /:queueId routes so "appointments" is not parsed as an id.
 */
router.get("/appointments/mine", attachJoiner, async (req, res, next) => {
  try {
    if (!req.user) return res.status(200).json({ appointments: [] });
    return res.status(200).json({ appointments: await listMyAppointments(req.user._id) });
  } catch (err) {
    return next(err);
  }
});

async function loadBookableQueue(queueId, res) {
  if (!mongoose.isValidObjectId(queueId)) {
    res.status(404).json({ error: "Queue not found" });
    return null;
  }
  const queue = await Queue.findOne({ _id: queueId, archivedAt: null });
  if (!queue) {
    res.status(404).json({ error: "Queue not found" });
    return null;
  }
  await expireMissedAppointments(queue);
  return queue;
}

async function loadOwnAppointment(queue, req, res) {
  const { appointmentId } = req.params;
  if (!mongoose.isValidObjectId(appointmentId)) {
    res.status(404).json({ error: BOOKING_ERRORS.notFound });
    return null;
  }
  const appointment = await Appointment.findOne({
    _id: appointmentId,
    queue: queue._id,
    user: req.user._id,
  });
  if (!appointment) {
    res.status(404).json({ error: BOOKING_ERRORS.notFound });
    return null;
  }
  return appointment;
}

function requireBookingUser(req, res) {
  if (!req.user) {
    res.status(401).json({ error: BOOKING_ERRORS.guest, code: "sign-in-to-book" });
    return false;
  }
  return true;
}

/**
 * GET /api/queues/:queueId/slots?date=YYYY-MM-DD — public slot grid for a campus day.
 */
router.get("/:queueId/slots", attachJoiner, async (req, res, next) => {
  try {
    const queue = await loadBookableQueue(req.params.queueId, res);
    if (!queue) return;
    const grid = await listSlots(queue, typeof req.query?.date === "string" ? req.query.date : null);
    let booking = null;
    if (req.user) {
      const mine = await Appointment.findOne({
        queue: queue._id,
        user: req.user._id,
        status: { $in: ["booked", "checked-in"] },
      }).populate("entry");
      if (mine && !(mine.status === "checked-in" && !["waiting", "serving"].includes(mine.entry?.status))) {
        booking = toAppointmentJSON(mine, { queue, entry: mine.entry });
      }
    }
    return res.status(200).json({ queue: { id: queue._id.toString(), name: queue.name }, ...grid, booking });
  } catch (err) {
    return next(err);
  }
});

/** POST /api/queues/:queueId/appointments — body { start } (ISO slot start). */
router.post("/:queueId/appointments", attachJoiner, async (req, res, next) => {
  try {
    if (!requireBookingUser(req, res)) return;
    const queue = await loadBookableQueue(req.params.queueId, res);
    if (!queue) return;
    const result = await bookSlot(queue, req.user, req.body?.start);
    if (!result.ok) return res.status(result.status).json({ error: result.error, ...(result.body || {}) });
    await recordAdminAudit({
      actor: req.user,
      action: "appointment-book",
      queue,
      meta: { slotStart: result.appointment.slotStart.toISOString() },
    });
    return res.status(201).json({ appointment: toAppointmentJSON(result.appointment, { queue }) });
  } catch (err) {
    return next(err);
  }
});

/** POST /api/queues/:queueId/appointments/:appointmentId/cancel */
router.post("/:queueId/appointments/:appointmentId/cancel", attachJoiner, async (req, res, next) => {
  try {
    if (!requireBookingUser(req, res)) return;
    const queue = await loadBookableQueue(req.params.queueId, res);
    if (!queue) return;
    const appointment = await loadOwnAppointment(queue, req, res);
    if (!appointment) return;
    const result = await cancelBooking(queue, appointment);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(200).json({ appointment: toAppointmentJSON(result.appointment, { queue }) });
  } catch (err) {
    return next(err);
  }
});

/** POST /api/queues/:queueId/appointments/:appointmentId/check-in — returns live status. */
router.post("/:queueId/appointments/:appointmentId/check-in", attachJoiner, async (req, res, next) => {
  try {
    if (!requireBookingUser(req, res)) return;
    const queue = await loadBookableQueue(req.params.queueId, res);
    if (!queue) return;
    const appointment = await loadOwnAppointment(queue, req, res);
    if (!appointment) return;
    await ensureQueueSessionState(queue);
    const result = await checkInAppointment(queue, appointment, { by: "self" });
    if (!result.ok) return res.status(result.status).json({ error: result.error, ...(result.body || {}) });
    const fresh = await Queue.findById(queue._id);
    return res.status(200).json(await buildStatusPayload(fresh, result.entry));
  } catch (err) {
    return next(err);
  }
});

/**
 * Resolve active membership for the current joiner (User or Guest).
 */
async function findJoinerActiveEntry(queueId, req) {
  if (req.user) {
    return findActiveEntry(queueId, req.user._id);
  }
  if (req.guest) {
    return findActiveGuestEntry(queueId, req.guest._id);
  }
  return null;
}

function joinerIdentity(req) {
  if (req.user) return { user: req.user._id };
  if (req.guest) return { guest: req.guest._id };
  return null;
}

function auditActor(req) {
  if (req.user) return req.user;
  if (req.guest) {
    return {
      _id: req.guest._id,
      name: "Guest",
      email: null,
      role: "guest",
    };
  }
  return null;
}

/**
 * Ensure a Guest document for join. Reuses req.guest or mints a new credential.
 * @returns {Promise<{ guest: import("mongoose").Document, minted: boolean }>}
 */
async function resolveGuestForJoin(req) {
  if (req.guest) {
    return { guest: req.guest, minted: false, rawCredential: null };
  }
  const rawCredential = Guest.mintCredential();
  const guest = await Guest.create({
    credential: Guest.hashCredential(rawCredential),
    hashed: true,
    networkHash: networkHashOf(req.ip),
  });
  return { guest, minted: true, rawCredential };
}

/**
 * POST /api/queues/:queueId/join — take a place in line; issue token + live status.
 * User (JWT) or Guest (existing credential or mint on first join).
 */
router.post("/:queueId/join", attachJoiner, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) {
      return res.status(404).json({ error: "Queue not found" });
    }

    const queue = await Queue.findById(queueId);
    if (!queue || queue.archivedAt) {
      return res.status(404).json({ error: "Queue not found" });
    }

    // Lazy auto-close at bound session end before join gate.
    await ensureQueueSessionState(queue);
    await expireNoShowCalls({ queueId: queue._id });

    // Closed: refuse new app tokens. Paused still allows join. Walk-in is admin-only.
    if (queue.acceptingTokens === false) {
      return res.status(409).json({
        error: "Queue is closed; not accepting tokens",
        reopenAt: queue.reopenAt ? new Date(queue.reopenAt).toISOString() : null,
      });
    }

    const full = await rejectIfQueueFull(queue);
    if (full) {
      return res.status(409).json(full);
    }

    let guest = null;
    let guestMinted = false;

    let mintedRawCredential = null;
    if (!req.user) {
      // Someone already in line (or able to recover a missed turn) gets the
      // usual 409 below; limits apply only to taking a brand-new place.
      const alreadyHere = req.guest
        ? (await findJoinerActiveEntry(queue._id, req)) || (await findRecoverableEntry(queue, joinerIdentity(req)))
        : null;
      if (!alreadyHere) {
        if (queue.guestJoin === false) {
          return res.status(403).json({ error: GUEST_JOIN_DISABLED, code: "guest-join-disabled" });
        }
        // Existing pass: per-pass limits. New pass: per-network mint cap.
        const limited = req.guest
          ? await checkExistingGuest(req.guest)
          : await checkGuestMint(networkHashOf(req.ip));
        if (limited) return res.status(limited.status).json(limited.body);
      }
      const resolved = await resolveGuestForJoin(req);
      guest = resolved.guest;
      guestMinted = resolved.minted;
      mintedRawCredential = resolved.rawCredential;
      // So findJoinerActiveEntry sees the guest for double-join checks.
      req.guest = guest;
    }

    const existing = await findJoinerActiveEntry(queue._id, req);
    if (existing) {
      return res.status(409).json({
        error: "Already in this queue",
      });
    }
    const recoverable = await findRecoverableEntry(queue, joinerIdentity(req));
    if (recoverable) {
      const until = recoveryDeadline(recoverable, queue);
      return res.status(409).json({
        error: "You can rejoin your missed turn",
        canRecover: true,
        recoverUntil: until ? until.toISOString() : null,
      });
    }

    // Atomic token issue so concurrent joins get unique numbers.
    const updated = await Queue.findByIdAndUpdate(
      queue._id,
      { $inc: { nextTokenNumber: 1 } },
      { returnDocument: "before" }
    );
    if (!updated) {
      return res.status(404).json({ error: "Queue not found" });
    }

    const tokenNumber = updated.nextTokenNumber;
    const entryFields = {
      queue: queue._id,
      tokenNumber,
      status: "waiting",
      isWalkIn: false,
      joinSource: req.body?.source === "qr" ? "qr" : "app",
    };
    if (req.user) {
      entryFields.user = req.user._id;
    } else {
      entryFields.guest = guest._id;
    }

    let entry;
    try {
      entry = await QueueEntry.create(entryFields);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return res.status(409).json({
          error: "Already in this queue",
        });
      }
      throw err;
    }

    const overflow = await releaseEntryIfOverCapacity(queue, entry);
    if (overflow) {
      return res.status(409).json(overflow);
    }

    // Reload queue for current nowServing / averageServiceTime after token bump.
    const freshQueue = await Queue.findById(queue._id);
    emitQueueChanged(queue._id, "join");
    const payload = await buildStatusPayload(freshQueue, entry);

    if (!req.user && guest) {
      // Return the raw secret only from the mint path or by echoing the
      // presented header — never the stored hash.
      if (guestMinted) {
        payload.guestCredential = mintedRawCredential;
        payload.guestCredentialMinted = true;
      } else {
        const presented = String(req.headers[GUEST_CREDENTIAL_HEADER] || "").trim();
        if (presented) payload.guestCredential = presented;
      }
    }

    return res.status(201).json(payload);
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/queues/:queueId/leave — free the caller's active place in line.
 */
router.post("/:queueId/leave", attachJoiner, requireJoiner, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    const queue = await Queue.findById(queueId);
    if (!queue) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    const identityFilter = req.user
      ? { user: req.user._id }
      : { guest: req.guest._id };
    // Atomic: a concurrent serve/skip cannot also claim this membership.
    const entry = await QueueEntry.findOneAndUpdate(
      {
        queue: queue._id,
        status: { $in: ACTIVE_ENTRY_STATUSES },
        ...identityFilter,
      },
      { $set: { status: "left" } },
      { returnDocument: "after" }
    );
    if (!entry) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    emitQueueChanged(queue._id, "leave");

    return res.status(200).json({
      status: "left",
      tokenNumber: entry.tokenNumber,
      queue: {
        id: queue._id.toString(),
        name: queue.name,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/queues/:queueId/here — called student checks in ("I'm here").
 * Flags presence and stops the no-show auto-skip for this call. Idempotent.
 */
router.post("/:queueId/here", attachJoiner, requireJoiner, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    const queue = await Queue.findById(queueId);
    if (!queue) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    const entry = await findJoinerActiveEntry(queue._id, req);
    if (!entry) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    const result = await acknowledgeArrival(queue, entry);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    const payload = await buildStatusPayload(queue, result.entry);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/queues/:queueId/rejoin — recover a skipped (no-show) place once.
 */
router.post("/:queueId/rejoin", attachJoiner, requireJoiner, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) {
      return res.status(404).json({ error: "Not a missed turn" });
    }
    const queue = await Queue.findById(queueId);
    if (!queue || queue.archivedAt) {
      return res.status(404).json({ error: "Not a missed turn" });
    }
    await ensureQueueSessionState(queue);
    await expireNoShowCalls({ queueId: queue._id });

    const result = await recoverMissedTurn({
      queue,
      identity: joinerIdentity(req),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    await recordAdminAudit({
      actor: auditActor(req),
      action: "rejoin",
      queue,
      meta: { tokenNumber: result.entry.tokenNumber },
    });

    const payload = await buildStatusPayload(queue, result.entry);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});


/**
 * POST /api/queues/:queueId/priority-request — student asks staff for priority.
 * Body: { reason: accessibility|pregnancy|medical|other }
 * Pending and rejected requests do not change place in line.
 */
router.post("/:queueId/priority-request", attachJoiner, requireJoiner, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) {
      return res.status(404).json({ error: "Not in this queue" });
    }
    const queue = await Queue.findById(queueId);
    if (!queue || queue.archivedAt) {
      return res.status(404).json({ error: "Not in this queue" });
    }
    await ensureQueueSessionState(queue);
    const entry = await findJoinerActiveEntry(queue._id, req);
    if (!entry) return res.status(404).json({ error: "Not in this queue" });
    const result = await requestPriority(queue, entry, { reason: req.body?.reason });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    await recordAdminAudit({
      actor: auditActor(req),
      action: "priority-request",
      queue,
      meta: { tokenNumber: result.entry.tokenNumber, reason: result.entry.priorityReason },
    });
    emitQueueChanged(queue._id, "priority");
    const payload = await buildStatusPayload(queue, result.entry);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/queues/:queueId/status — poll token, position, ETA, now serving.
 * Requires an active membership, or a skipped entry still inside the recovery window.
 */
router.get("/:queueId/status", attachJoiner, requireJoiner, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    const queue = await Queue.findById(queueId);
    if (!queue) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    await ensureQueueSessionState(queue);
    await expireNoShowCalls({ queueId: queue._id });

    let entry = await findJoinerActiveEntry(queue._id, req);
    if (!entry) {
      entry = await findRecoverableEntry(queue, joinerIdentity(req));
    }
    if (!entry) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    const payload = await buildStatusPayload(queue, entry);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

export default router;
