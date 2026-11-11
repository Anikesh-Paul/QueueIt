import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { Queue } from "../models/Queue.js";
import { Venue } from "../models/Venue.js";
import { QueueEntry, isDuplicateKeyError } from "../models/QueueEntry.js";
import { parseArrivalValue } from "../services/arrivalPass.js";
import { dateRangeMatch, resolveAnalyticsRange } from "../services/analyticsRange.js";
import { emitQueueChanged } from "../services/realtime.js";
import {
  applyExtend,
  applyServiceWindowsUpdate,
  applyStartAccepting,
  applyStopAccepting,
  autoPrepareIfClosedEmpty,
  ensureQueueSessionState,
  sessionFieldsForJson,
} from "../services/queueSession.js";
import {
  advanceLineEntry,
  callWaitingEntry,
  expireNoShowCalls,
  freezeServingDeadlines,
  resumeServingDeadlines,
  servingFieldsForJson,
} from "../services/servingDeadline.js";
import { countersForJson, ensureDefaultCounters, clearAllCounterNowServing } from "../services/counters.js";
import {
  addCounter,
  createQueue as createCatalogQueue,
  createVenue,
  listAdminCatalog,
  removeCounter,
  renameCounter,
  toAdminCatalogQueueJSON,
  updateQueue as updateCatalogQueue,
  updateVenue,
} from "../services/catalogAdmin.js";

const router = Router();

/**
 * GET /api/admin/ping — admin-only probe for role enforcement.
 */
router.get("/ping", requireAuth, requireAdmin, (req, res) => {
  res.status(200).json({
    ok: true,
    role: req.user.role,
  });
});

/** Public queue summary for admin control responses. */
function toAdminQueueJSON(queue) {
  return {
    id: queue._id.toString(),
    name: queue.name,
    status: queue.status,
    acceptingTokens: queue.acceptingTokens !== false,
    nowServing: queue.nowServing ?? null,
    averageServiceTime: queue.averageServiceTime,
    noShowMinutes: queue.noShowMinutes ?? 5,
    counters: countersForJson(queue),
    archived: Boolean(queue.archivedAt),
    ...sessionFieldsForJson(queue),
  };
}

/**
 * Waiting-list row for one entry.
 * Guest rows: token-first + isGuest (no name/email; not walk-in).
 * Walk-ins remain isWalkIn with walkInName — never labeled Guest.
 */
function toWaitingRow(entry, position, { paused = false, queue = null } = {}) {
  const isWalkIn = Boolean(entry.isWalkIn);
  const isGuest = Boolean(entry.guest) && !isWalkIn;
  let user;

  if (isWalkIn) {
    user = {
      id: null,
      name: entry.walkInName || "Walk-in",
      email: null,
    };
  } else if (isGuest) {
    user = {
      id: null,
      name: null,
      email: null,
    };
  } else {
    const userDoc = entry.user;
    user =
      userDoc && typeof userDoc === "object" && userDoc.email
        ? {
            id: userDoc._id.toString(),
            name: userDoc.name,
            email: userDoc.email,
          }
        : {
            id: (userDoc?._id ?? userDoc)?.toString?.() ?? String(userDoc),
            name: null,
            email: null,
          };
  }

  return {
    id: entry._id.toString(),
    tokenNumber: entry.tokenNumber,
    position,
    status: entry.status,
    user,
    isWalkIn,
    isGuest,
    joinedAt: entry.createdAt?.toISOString?.() ?? entry.createdAt,
    ...servingFieldsForJson(entry, { paused, queue }),
  };
}

async function loadQueueOr404(queueId, res) {
  if (!mongoose.isValidObjectId(queueId)) {
    res.status(404).json({ error: "Queue not found" });
    return null;
  }
  const queue = await Queue.findById(queueId);
  if (!queue) {
    res.status(404).json({ error: "Queue not found" });
    return null;
  }
  // Lazy auto-close when past bound session end; also skip expired no-shows.
  await ensureQueueSessionState(queue);
  await expireNoShowCalls({ queueId: queue._id });
  if (ensureDefaultCounters(queue)) {
    await queue.save();
  }
  return queue;
}

function rejectIfPaused(queue, res) {
  if (queue.status === "paused") {
    res.status(409).json({ error: "Queue is paused; resume before advancing" });
    return true;
  }
  return false;
}

/**
 * Advance one waiting entry to a terminal status (served | skipped).
 * Sets nowServing so the line does not stall. Shared by serve and skip.
 *
 * @param {import("mongoose").Document} queue
 * @param {{ entryId?: string }} options
 * @param {"served" | "skipped"} terminalStatus
 * @returns {Promise<
 *   | { ok: true, entry: import("mongoose").Document, queue: import("mongoose").Document }
 *   | { ok: false, status: number, error: string }
 * >}
 */
async function advanceWaitingEntry(queue, options, terminalStatus) {
  return advanceLineEntry(queue, options, terminalStatus);
}

/**
 * GET /api/admin/queues/:queueId/waiting-list
 * Waiting entries ordered by token; positions 1..n among waiters.
 */
router.get("/queues/:queueId/waiting-list", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

    const paused = queue.status === "paused";
    const entries = await QueueEntry.find({
      queue: queue._id,
      status: { $in: ["waiting", "serving"] },
    })
      .populate("user")
      .sort({ status: 1, tokenNumber: 1 }) // serving before waiting
      .exec();

    let waiterPosition = 0;
    const waiting = entries.map((entry) => {
      const position = entry.status === "serving" ? 0 : (waiterPosition += 1);
      return toWaitingRow(entry, position, { paused, queue });
    });

    return res.status(200).json({
      queue: toAdminQueueJSON(queue),
      waiting,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/queues/:queueId/serve
 * Body optional: { entryId }. Serves next waiter if omitted.
 * Marks entry served, sets nowServing. Blocked while paused.
 */
router.post("/queues/:queueId/serve", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;
    if (rejectIfPaused(queue, res)) return;

    const result = await advanceWaitingEntry(queue, { entryId: req.body?.entryId, counterId: req.body?.counterId }, "served");
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    const { entry } = result;
    return res.status(200).json({
      served: {
        id: entry._id.toString(),
        tokenNumber: entry.tokenNumber,
        status: entry.status,
      },
      queue: toAdminQueueJSON(result.queue),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/queues/:queueId/skip
 * Body optional: { entryId }. Skips next waiter if omitted.
 * Marks entry skipped, advances nowServing. Blocked while paused.
 */
router.post("/queues/:queueId/skip", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;
    if (rejectIfPaused(queue, res)) return;

    const result = await advanceWaitingEntry(queue, { entryId: req.body?.entryId, counterId: req.body?.counterId }, "skipped");
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    const { entry } = result;
    return res.status(200).json({
      skipped: {
        id: entry._id.toString(),
        tokenNumber: entry.tokenNumber,
        status: entry.status,
      },
      queue: toAdminQueueJSON(result.queue),
    });
  } catch (err) {
    return next(err);
  }
});


/**
 * POST /api/admin/queues/:queueId/call
 * Body optional: { entryId }. Calls next waiter if omitted.
 * Moves the entry to serving, sets nowServing, and starts the no-show timer.
 * Blocked while paused, and while someone is already being called.
 */
router.post("/queues/:queueId/call", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;
    if (rejectIfPaused(queue, res)) return;

    const result = await callWaitingEntry(queue, { entryId: req.body?.entryId, counterId: req.body?.counterId });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    const { entry } = result;
    return res.status(200).json({
      called: {
        id: entry._id.toString(),
        tokenNumber: entry.tokenNumber,
        status: entry.status,
        servingDeadlineAt: entry.servingDeadlineAt,
      },
      queue: toAdminQueueJSON(result.queue),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/queues/:queueId/walk-in
 * Body: { name: string, tokenNumber?: number }
 * Adds a counter walk-in (no app account) with auto or manual token.
 * Participates in serve/skip like any waiting entry. Allowed while paused.
 */
router.post("/queues/:queueId/walk-in", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;
    if (queue.archivedAt) {
      return res.status(409).json({ error: "This queue is archived" });
    }

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      return res.status(400).json({ error: "Walk-in name is required" });
    }
    if (name.length > 80) {
      return res.status(400).json({ error: "Walk-in name is too long" });
    }

    const rawToken = req.body?.tokenNumber;
    let tokenNumber;

    if (rawToken === undefined || rawToken === null || rawToken === "") {
      // Auto: same atomic issue path as app join.
      const updated = await Queue.findByIdAndUpdate(
        queue._id,
        { $inc: { nextTokenNumber: 1 } },
        { returnDocument: "before" }
      );
      if (!updated) {
        return res.status(404).json({ error: "Queue not found" });
      }
      tokenNumber = updated.nextTokenNumber;
    } else {
      const parsed = Number(rawToken);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return res.status(400).json({ error: "tokenNumber must be a positive integer" });
      }
      tokenNumber = parsed;

      // Reject if an active entry already holds this token on the queue.
      const conflict = await QueueEntry.findOne({
        queue: queue._id,
        tokenNumber,
        status: { $in: ["waiting", "serving"] },
      }).exec();
      if (conflict) {
        return res.status(409).json({ error: "Token already in use in this queue" });
      }

      // Keep sequential issuer ahead of any manual token.
      await Queue.findByIdAndUpdate(queue._id, {
        $max: { nextTokenNumber: tokenNumber + 1 },
      });
    }

    let entry;
    try {
      entry = await QueueEntry.create({
        queue: queue._id,
        user: null,
        isWalkIn: true,
        walkInName: name,
        tokenNumber,
        status: "waiting",
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return res.status(409).json({ error: "Token already in use in this queue" });
      }
      throw err;
    }

    emitQueueChanged(queue._id, "walk-in");

    const freshQueue = await Queue.findById(queue._id);
    const waitingCount = await QueueEntry.countDocuments({
      queue: queue._id,
      status: "waiting",
      tokenNumber: { $lte: tokenNumber },
    });

    return res.status(201).json({
      entry: {
        id: entry._id.toString(),
        tokenNumber: entry.tokenNumber,
        status: entry.status,
        isWalkIn: true,
        name,
        position: waitingCount,
      },
      queue: toAdminQueueJSON(freshQueue),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/queues/:queueId/verify-qr
 * Counter arrival check: match a user's QR pass (signed or legacy unsigned)
 * or a bare token number against this queue's waiting list.
 * A match means the token is waiting — not a proof of identity.
 * A non-match is a valid counter outcome — 200 { verified: false, reason } —
 * not an HTTP error. Malformed input (no value) is a 400 client bug.
 */
router.post("/queues/:queueId/verify-qr", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

    const value = typeof req.body?.value === "string" ? req.body.value : "";
    if (!value.trim()) {
      return res.status(400).json({ error: "Pass or token number is required" });
    }

    const parsed = parseArrivalValue(value);
    if (!parsed) {
      return res.status(200).json({
        verified: false,
        reason: "That doesn't look like a valid pass or token number",
      });
    }
    if (parsed.invalidSignature) {
      return res.status(200).json({
        verified: false,
        reason: "This pass is not valid",
      });
    }

    if (parsed.queueId && parsed.queueId !== queue._id.toString()) {
      return res.status(200).json({
        verified: false,
        reason: "This pass belongs to a different queue",
      });
    }

    const entry = await QueueEntry.findOne({
      queue: queue._id,
      tokenNumber: parsed.tokenNumber,
      status: { $in: ["waiting", "serving"] },
    }).populate("user");

    if (!entry) {
      return res.status(200).json({
        verified: false,
        reason: "No one in line with this token",
      });
    }

    const ahead = await QueueEntry.countDocuments({
      queue: queue._id,
      status: "waiting",
      tokenNumber: { $lt: entry.tokenNumber },
    });

    return res.status(200).json({
      verified: true,
      signed: Boolean(parsed.signed),
      entry: toWaitingRow(entry, ahead + 1),
      queue: toAdminQueueJSON(queue),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/queues/:queueId/reset
 * Clear-line: closes every waiting entry as left (users keep a history event
 * and can rejoin), clears now serving, restarts tokens at 1, and unpauses
 * advancement (status open). Does not change acceptingTokens — use
 * start-accepting for that. Works while paused. Idempotent: empty list →
 * cleared: 0 with the same reset outcome.
 */
router.post("/queues/:queueId/reset", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

    // Reset the queue atomically first (same $set discipline as token issuance)
    // so a join landing mid-reset cannot reuse a token number already reset to 1.
    // Does not flip acceptingTokens — Reset is clear-line, not start-accepting.
    const updated = await Queue.findByIdAndUpdate(
      queue._id,
      { $set: { status: "open", nowServing: null, nextTokenNumber: 1 } },
      { returnDocument: "after" }
    );
    if (!updated) {
      return res.status(404).json({ error: "Queue not found" });
    }
    if (updated.counters?.length) {
      clearAllCounterNowServing(updated);
      await updated.save();
    }

    // Close any waiting entries created before the reset (including one racing
    // in between the two writes) so the waiting list ends empty.
    const closed = await QueueEntry.updateMany(
      { queue: queue._id, status: { $in: ["waiting", "serving"] } },
      { $set: { status: "left", servingDeadlineAt: null, servingPausedRemainingMs: null } }
    );

    emitQueueChanged(queue._id, "reset");

    return res.status(200).json({
      cleared: closed.modifiedCount,
      queue: toAdminQueueJSON(updated),
    });
  } catch (err) {
    return next(err);
  }
});

/** Round a wait in minutes to one decimal for display. */
function roundWaitMinutes(value) {
  return Math.round(value * 10) / 10;
}

/**
 * GET /api/admin/queues/:queueId/analytics
 * Ops storytelling metrics for one queue (not a BI product):
 *   - servedCount / skippedCount / leftCount / waitingCount
 *   - averageWaitMinutes + longestWaitMinutes over served entries
 *     (wait = time from join until the entry left the line as served,
 *      i.e. updatedAt - createdAt of the entry)
 *   - peakHours: top 3 busiest hourly buckets by serves (campus time / IST)
 * Peaks are derived from data already tracked — no snapshots required.
 * Storage remains UTC; bucketing/labels convert at present to Asia/Kolkata.
 */
router.get("/queues/:queueId/analytics", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

    const range = resolveAnalyticsRange(req.query || {});
    if (!range.ok) {
      return res.status(400).json({ error: range.error });
    }
    // Waiting is always the live line. Terminal counts / waits / peaks honor the window.
    const terminalMatch = dateRangeMatch("updatedAt", range);

    const [servedCount, skippedCount, leftCount, waitingCount, [facet]] = await Promise.all([
      QueueEntry.countDocuments({ queue: queue._id, status: "served", ...terminalMatch }),
      QueueEntry.countDocuments({ queue: queue._id, status: "skipped", ...terminalMatch }),
      QueueEntry.countDocuments({ queue: queue._id, status: "left", ...terminalMatch }),
      QueueEntry.countDocuments({ queue: queue._id, status: "waiting" }),
      QueueEntry.aggregate([
        { $match: { queue: queue._id, status: "served", ...terminalMatch } },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  waitMinutesSum: {
                    $sum: {
                      $divide: [{ $subtract: ["$updatedAt", "$createdAt"] }, 60000],
                    },
                  },
                  maxWaitMinutes: {
                    $max: {
                      $divide: [{ $subtract: ["$updatedAt", "$createdAt"] }, 60000],
                    },
                  },
                },
              },
            ],
            peakHours: [
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: "%H:00 IST",
                      date: "$updatedAt",
                      timezone: "Asia/Kolkata",
                    },
                  },
                  served: { $sum: 1 },
                },
              },
              { $sort: { served: -1, _id: 1 } },
              { $limit: 3 },
            ],
          },
        },
      ]),
    ]);

    const totals = facet?.totals?.[0] || { count: 0, waitMinutesSum: 0, maxWaitMinutes: 0 };
    const hasServed = totals.count > 0;

    return res.status(200).json({
      queue: toAdminQueueJSON(queue),
      range: {
        preset: range.preset,
        from: range.from ? range.from.toISOString() : null,
        to: range.to ? range.to.toISOString() : null,
      },
      metrics: {
        servedCount,
        skippedCount,
        leftCount,
        waitingCount,
        averageWaitMinutes: hasServed ? roundWaitMinutes(totals.waitMinutesSum / totals.count) : null,
        longestWaitMinutes: hasServed ? roundWaitMinutes(totals.maxWaitMinutes) : null,
      },
      peakHours: (facet?.peakHours || []).map((hour) => ({
        label: hour._id,
        served: hour.served,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/queues/:queueId/pause
 * Freezes advancement; waiting list is preserved.
 * Orthogonal to Closed: join may still take tokens while paused.
 */
router.post("/queues/:queueId/pause", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

    queue.status = "paused";
    await freezeServingDeadlines(queue._id);
    await queue.save();

    emitQueueChanged(queue._id, "pause");

    return res.status(200).json({
      queue: toAdminQueueJSON(queue),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/queues/:queueId/resume
 * Re-opens service after pause (advancement only; does not change accepting tokens).
 */
router.post("/queues/:queueId/resume", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

    queue.status = "open";
    await resumeServingDeadlines(queue._id);
    await queue.save();

    emitQueueChanged(queue._id, "resume");

    return res.status(200).json({
      queue: toAdminQueueJSON(queue),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/queues/:queueId/stop-accepting
 * Sets Closed: refuse new app joins; preserve waiting list (drain).
 * Default student reopen = next scheduled window start; body.reopenAt overrides.
 * Orthogonal to Pause. Walk-in still allowed. Not Reset.
 */
router.post(
  "/queues/:queueId/stop-accepting",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const queue = await loadQueueOr404(req.params.queueId, res);
      if (!queue) return;

      const applied = applyStopAccepting(queue, req.body || {});
      if (!applied.ok) {
        return res.status(applied.status).json({ error: applied.error });
      }
      await autoPrepareIfClosedEmpty(queue);
      await queue.save();

      emitQueueChanged(queue._id, "stop-accepting");

      return res.status(200).json({
        queue: toAdminQueueJSON(queue),
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /api/admin/queues/:queueId/start-accepting
 * Leaves Closed and begins issuing tokens, bound to the target service window.
 * Does not unpause — Pause remains independent. No auto-open at window start.
 */
router.post(
  "/queues/:queueId/start-accepting",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const queue = await loadQueueOr404(req.params.queueId, res);
      if (!queue) return;

      applyStartAccepting(queue);
      await queue.save();

      emitQueueChanged(queue._id, "start-accepting");

      return res.status(200).json({
        queue: toAdminQueueJSON(queue),
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /api/admin/queues/:queueId/extend
 * Push auto-close end while accepting tokens.
 * Body: { minutes: 15|30 } or { endsAt: ISO string }.
 */
router.post(
  "/queues/:queueId/extend",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const queue = await loadQueueOr404(req.params.queueId, res);
      if (!queue) return;

      const applied = applyExtend(queue, req.body || {});
      if (!applied.ok) {
        return res.status(applied.status).json({ error: applied.error });
      }
      await queue.save();

      emitQueueChanged(queue._id, "extend");

      return res.status(200).json({
        queue: toAdminQueueJSON(queue),
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * PUT /api/admin/queues/:queueId/service-windows
 * Replace daily service windows (same pattern every day; campus IST HH:mm).
 * Body: { serviceWindows: [{ start, end }, ...] }.
 * Overlaps rejected; end must be after start. Adjacent windows allowed.
 * When Closed, recomputes reopenAt from the new schedule.
 */
router.put(
  "/queues/:queueId/service-windows",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const queue = await loadQueueOr404(req.params.queueId, res);
      if (!queue) return;

      const applied = applyServiceWindowsUpdate(
        queue,
        req.body?.serviceWindows
      );
      if (!applied.ok) {
        return res.status(applied.status).json({ error: applied.error });
      }
      await queue.save();

      emitQueueChanged(queue._id, "service-windows");

      return res.status(200).json({
        queue: toAdminQueueJSON(queue),
      });
    } catch (err) {
      return next(err);
    }
  }
);


async function loadVenueOr404(venueId, res) {
  if (!mongoose.isValidObjectId(venueId)) {
    res.status(404).json({ error: "Venue not found" });
    return null;
  }
  const venue = await Venue.findById(venueId);
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return null;
  }
  return venue;
}

/**
 * GET /api/admin/catalog — venues and their queues, including archived.
 */
router.get("/catalog", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const venues = await listAdminCatalog();
    return res.status(200).json({ venues });
  } catch (err) {
    return next(err);
  }
});

router.post("/venues", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const result = await createVenue({ name: req.body?.name });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json({ venue: result.venue.toPublicJSON() });
  } catch (err) {
    return next(err);
  }
});

router.patch("/venues/:venueId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const venue = await loadVenueOr404(req.params.venueId, res);
    if (!venue) return;
    const result = await updateVenue(venue, { name: req.body?.name });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(200).json({ venue: result.venue.toPublicJSON() });
  } catch (err) {
    return next(err);
  }
});

router.post("/queues", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const result = await createCatalogQueue({
      venueId: req.body?.venueId,
      name: req.body?.name,
      averageServiceTime: req.body?.averageServiceTime,
      serviceWindows: req.body?.serviceWindows,
      counters: req.body?.counters,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json({
      queue: toAdminCatalogQueueJSON(result.queue, result.venue),
    });
  } catch (err) {
    return next(err);
  }
});

router.patch("/queues/:queueId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;
    const result = await updateCatalogQueue(queue, {
      name: req.body?.name,
      averageServiceTime: req.body?.averageServiceTime,
      serviceWindows: req.body?.serviceWindows,
      archived: req.body?.archived,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const venue = await Venue.findById(result.queue.venue);
    return res.status(200).json({
      queue: toAdminCatalogQueueJSON(result.queue, venue),
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/queues/:queueId/counters", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;
    const result = await addCounter(queue, { name: req.body?.name });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json({
      queue: toAdminQueueJSON(result.queue),
      counter: {
        id: result.counter._id.toString(),
        name: result.counter.name,
        nowServing: result.counter.nowServing ?? null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.patch(
  "/queues/:queueId/counters/:counterId",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const queue = await loadQueueOr404(req.params.queueId, res);
      if (!queue) return;
      const result = await renameCounter(queue, req.params.counterId, { name: req.body?.name });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(200).json({ queue: toAdminQueueJSON(result.queue) });
    } catch (err) {
      return next(err);
    }
  }
);

router.delete(
  "/queues/:queueId/counters/:counterId",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const queue = await loadQueueOr404(req.params.queueId, res);
      if (!queue) return;
      const result = await removeCounter(queue, req.params.counterId);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(200).json({ queue: toAdminQueueJSON(result.queue) });
    } catch (err) {
      return next(err);
    }
  }
);

export default router;
