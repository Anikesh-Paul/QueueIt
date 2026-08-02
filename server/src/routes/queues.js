import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import {
  buildStatusPayload,
  findActiveEntry,
  toHistoryEvent,
} from "../services/queueStatus.js";
// Register Venue model so Queue.populate("venue") resolves at runtime.
import "../models/Venue.js";

const router = Router();

/**
 * GET /api/queues — list available queues (seeded catalog).
 * Any authenticated role may list; join/admin controls are later tickets.
 */
router.get("/", requireAuth, async (_req, res, next) => {
  try {
    // Catalog of available (open) queues for the seeded venue(s).
    // Include paused so users can still see lines; join allows open + paused.
    const queues = await Queue.find({ status: { $in: ["open", "paused"] } })
      .populate("venue")
      .sort({ name: 1 })
      .exec();

    return res.status(200).json({
      queues: queues.map((q) => q.toPublicJSON()),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/queues/history — authenticated user's queue events (newest first).
 * Outcomes: joined (active waiting/serving), left, served, skipped.
 * Registered before /:queueId routes so "history" is not parsed as an id.
 */
router.get("/history", requireAuth, async (req, res, next) => {
  try {
    const entries = await QueueEntry.find({ user: req.user._id })
      .populate("queue")
      .sort({ updatedAt: -1, createdAt: -1 })
      .exec();

    return res.status(200).json({
      events: entries.map((entry) => toHistoryEvent(entry)),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/queues/:queueId/join — take a place in line; issue token + live status.
 */
router.post("/:queueId/join", requireAuth, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) {
      return res.status(404).json({ error: "Queue not found" });
    }

    const queue = await Queue.findById(queueId);
    if (!queue) {
      return res.status(404).json({ error: "Queue not found" });
    }

    const existing = await findActiveEntry(queue._id, req.user._id);
    if (existing) {
      return res.status(409).json({
        error: "Already in this queue",
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
    const entry = await QueueEntry.create({
      queue: queue._id,
      user: req.user._id,
      tokenNumber,
      status: "waiting",
    });

    // Reload queue for current nowServing / averageServiceTime after token bump.
    const freshQueue = await Queue.findById(queue._id);
    const payload = await buildStatusPayload(freshQueue, entry);
    return res.status(201).json(payload);
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/queues/:queueId/leave — free the caller's active place in line.
 */
router.post("/:queueId/leave", requireAuth, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    const queue = await Queue.findById(queueId);
    if (!queue) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    const entry = await findActiveEntry(queue._id, req.user._id);
    if (!entry) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    entry.status = "left";
    await entry.save();

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
 * GET /api/queues/:queueId/status — poll token, position, ETA, now serving.
 * Requires the caller to hold an active membership in this queue.
 */
router.get("/:queueId/status", requireAuth, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    const queue = await Queue.findById(queueId);
    if (!queue) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    const entry = await findActiveEntry(queue._id, req.user._id);
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
