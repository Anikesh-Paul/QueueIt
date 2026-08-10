import { Router } from "express";
import mongoose from "mongoose";
import { attachJoiner, requireJoiner } from "../middleware/auth.js";
import { Guest } from "../models/Guest.js";
import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import {
  buildStatusPayload,
  findActiveEntry,
  findActiveGuestEntry,
  toHistoryEvent,
} from "../services/queueStatus.js";
import { emitQueueChanged } from "../services/realtime.js";
// Register Venue model so Queue.populate("venue") resolves at runtime.
import "../models/Venue.js";

const router = Router();

/**
 * GET /api/queues — list available queues (seeded catalog).
 * Public: Guests may browse without a credential; JWT optional.
 */
router.get("/", async (_req, res, next) => {
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
 * GET /api/queues/history — User History or Guest device-local history (newest first).
 * Outcomes: joined (active waiting/serving), left, served, skipped.
 * Registered before /:queueId routes so "history" is not parsed as an id.
 */
router.get("/history", attachJoiner, requireJoiner, async (req, res, next) => {
  try {
    const filter = req.user
      ? { user: req.user._id }
      : { guest: req.guest._id };

    const entries = await QueueEntry.find(filter)
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

/**
 * Ensure a Guest document for join. Reuses req.guest or mints a new credential.
 * @returns {Promise<{ guest: import("mongoose").Document, minted: boolean }>}
 */
async function resolveGuestForJoin(req) {
  if (req.guest) {
    return { guest: req.guest, minted: false };
  }
  const credential = Guest.mintCredential();
  const guest = await Guest.create({ credential });
  return { guest, minted: true };
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
    if (!queue) {
      return res.status(404).json({ error: "Queue not found" });
    }

    let guest = null;
    let guestMinted = false;

    if (!req.user) {
      const resolved = await resolveGuestForJoin(req);
      guest = resolved.guest;
      guestMinted = resolved.minted;
      // So findJoinerActiveEntry sees the guest for double-join checks.
      req.guest = guest;
    }

    const existing = await findJoinerActiveEntry(queue._id, req);
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
    const entryFields = {
      queue: queue._id,
      tokenNumber,
      status: "waiting",
      isWalkIn: false,
    };
    if (req.user) {
      entryFields.user = req.user._id;
    } else {
      entryFields.guest = guest._id;
    }

    const entry = await QueueEntry.create(entryFields);

    // Reload queue for current nowServing / averageServiceTime after token bump.
    const freshQueue = await Queue.findById(queue._id);
    emitQueueChanged(queue._id, "join");
    const payload = await buildStatusPayload(freshQueue, entry);

    if (!req.user && guest) {
      // Always echo credential so the client can persist after first join.
      payload.guestCredential = guest.credential;
      // Hint whether this response minted (clients may ignore).
      if (guestMinted) {
        payload.guestCredentialMinted = true;
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

    const entry = await findJoinerActiveEntry(queue._id, req);
    if (!entry) {
      return res.status(404).json({ error: "Not in this queue" });
    }

    entry.status = "left";
    await entry.save();

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
 * GET /api/queues/:queueId/status — poll token, position, ETA, now serving.
 * Requires the caller to hold an active membership in this queue.
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

    const entry = await findJoinerActiveEntry(queue._id, req);
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
