import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import { parseArrivalValue } from "../services/arrivalPass.js";
import { emitQueueChanged } from "../services/realtime.js";

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
    nowServing: queue.nowServing ?? null,
    averageServiceTime: queue.averageServiceTime,
  };
}

/**
 * Waiting-list row for one entry.
 * Guest rows: token-first + isGuest (no name/email; not walk-in).
 * Walk-ins remain isWalkIn with walkInName — never labeled Guest.
 */
function toWaitingRow(entry, position) {
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
    user,
    isWalkIn,
    isGuest,
    joinedAt: entry.createdAt?.toISOString?.() ?? entry.createdAt,
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
  return queue;
}

/**
 * Resolve a waiting entry: optional entryId, else next by lowest tokenNumber.
 * @returns {Promise<{ entry: import("mongoose").Document | null, error?: string, status?: number }>}
 */
async function resolveWaitingEntry(queueId, entryId) {
  if (entryId) {
    if (!mongoose.isValidObjectId(entryId)) {
      return { entry: null, error: "Waiting entry not found", status: 404 };
    }
    const entry = await QueueEntry.findOne({
      _id: entryId,
      queue: queueId,
      status: "waiting",
    });
    if (!entry) {
      return { entry: null, error: "Waiting entry not found", status: 404 };
    }
    return { entry };
  }

  const entry = await QueueEntry.findOne({ queue: queueId, status: "waiting" })
    .sort({ tokenNumber: 1 })
    .exec();
  if (!entry) {
    return { entry: null, error: "No one waiting", status: 404 };
  }
  return { entry };
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
async function advanceWaitingEntry(queue, { entryId } = {}, terminalStatus) {
  const resolved = await resolveWaitingEntry(queue._id, entryId);
  if (!resolved.entry) {
    return {
      ok: false,
      status: resolved.status || 404,
      error: resolved.error || "No one waiting",
    };
  }

  const entry = resolved.entry;
  entry.status = terminalStatus;
  await entry.save();

  queue.nowServing = entry.tokenNumber;
  await queue.save();

  emitQueueChanged(queue._id, terminalStatus);

  return { ok: true, entry, queue };
}

/**
 * GET /api/admin/queues/:queueId/waiting-list
 * Waiting entries ordered by token; positions 1..n among waiters.
 */
router.get("/queues/:queueId/waiting-list", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

    const entries = await QueueEntry.find({ queue: queue._id, status: "waiting" })
      .populate("user")
      .sort({ tokenNumber: 1 })
      .exec();

    const waiting = entries.map((entry, index) => toWaitingRow(entry, index + 1));

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

    const result = await advanceWaitingEntry(queue, { entryId: req.body?.entryId }, "served");
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

    const result = await advanceWaitingEntry(queue, { entryId: req.body?.entryId }, "skipped");
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
 * POST /api/admin/queues/:queueId/walk-in
 * Body: { name: string, tokenNumber?: number }
 * Adds a counter walk-in (no app account) with auto or manual token.
 * Participates in serve/skip like any waiting entry. Allowed while paused.
 */
router.post("/queues/:queueId/walk-in", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

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

    const entry = await QueueEntry.create({
      queue: queue._id,
      user: null,
      isWalkIn: true,
      walkInName: name,
      tokenNumber,
      status: "waiting",
    });

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
 * Counter arrival check: match a user's QR pass (`QIT:<queueId>:<tokenNumber>`)
 * or a bare token number against this queue's waiting list.
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

    if (parsed.queueId && parsed.queueId !== queue._id.toString()) {
      return res.status(200).json({
        verified: false,
        reason: "This pass belongs to a different queue",
      });
    }

    const entry = await QueueEntry.findOne({
      queue: queue._id,
      tokenNumber: parsed.tokenNumber,
      status: "waiting",
    }).populate("user");

    if (!entry) {
      return res.status(200).json({
        verified: false,
        reason: "No one waiting with this token",
      });
    }

    const ahead = await QueueEntry.countDocuments({
      queue: queue._id,
      status: "waiting",
      tokenNumber: { $lt: entry.tokenNumber },
    });

    return res.status(200).json({
      verified: true,
      entry: toWaitingRow(entry, ahead + 1),
      queue: toAdminQueueJSON(queue),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/queues/:queueId/reset
 * End-of-session / day close. Closes every waiting entry as left (users keep a
 * history event and can rejoin), clears now serving, restarts tokens at 1, and
 * re-opens the queue. Works while paused. Idempotent: clearing an empty list
 * returns cleared: 0 with the same reset outcome.
 */
router.post("/queues/:queueId/reset", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

    // Reset the queue atomically first (same $set discipline as token issuance)
    // so a join landing mid-reset cannot reuse a token number already reset to 1.
    const updated = await Queue.findByIdAndUpdate(
      queue._id,
      { $set: { status: "open", nowServing: null, nextTokenNumber: 1 } },
      { returnDocument: "after" }
    );
    if (!updated) {
      return res.status(404).json({ error: "Queue not found" });
    }

    // Close any waiting entries created before the reset (including one racing
    // in between the two writes) so the waiting list ends empty.
    const closed = await QueueEntry.updateMany(
      { queue: queue._id, status: "waiting" },
      { $set: { status: "left" } }
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

    const [servedCount, skippedCount, leftCount, waitingCount, [facet]] = await Promise.all([
      QueueEntry.countDocuments({ queue: queue._id, status: "served" }),
      QueueEntry.countDocuments({ queue: queue._id, status: "skipped" }),
      QueueEntry.countDocuments({ queue: queue._id, status: "left" }),
      QueueEntry.countDocuments({ queue: queue._id, status: "waiting" }),
      QueueEntry.aggregate([
        { $match: { queue: queue._id, status: "served" } },
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
 */
router.post("/queues/:queueId/pause", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

    queue.status = "paused";
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
 * Re-opens service after pause.
 */
router.post("/queues/:queueId/resume", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

    queue.status = "open";
    await queue.save();

    emitQueueChanged(queue._id, "resume");

    return res.status(200).json({
      queue: toAdminQueueJSON(queue),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
