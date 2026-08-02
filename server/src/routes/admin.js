import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";

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

/** Waiting-list row for one entry (user may be populated). */
function toWaitingRow(entry, position) {
  const userDoc = entry.user;
  const user =
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

  return {
    id: entry._id.toString(),
    tokenNumber: entry.tokenNumber,
    position,
    user,
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
 * POST /api/admin/queues/:queueId/pause
 * Freezes advancement; waiting list is preserved.
 */
router.post("/queues/:queueId/pause", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const queue = await loadQueueOr404(req.params.queueId, res);
    if (!queue) return;

    queue.status = "paused";
    await queue.save();

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

    return res.status(200).json({
      queue: toAdminQueueJSON(queue),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
