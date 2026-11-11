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
import { expireNoShowCalls } from "../services/servingDeadline.js";
// Register Venue model so Queue.populate("venue") resolves at runtime.
import "../models/Venue.js";

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
    for (const entry of entries) {
      const queue = entry.queue;
      if (!queue) continue;
      await ensureQueueSessionState(queue);
    await expireNoShowCalls({ queueId: queue._id });
      memberships.push(await buildStatusPayload(queue, entry));
    }

    return res.status(200).json({ memberships });
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
    return { guest: req.guest, minted: false, rawCredential: null };
  }
  const rawCredential = Guest.mintCredential();
  const guest = await Guest.create({
    credential: Guest.hashCredential(rawCredential),
    hashed: true,
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

    let guest = null;
    let guestMinted = false;

    let mintedRawCredential = null;
    if (!req.user) {
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

    await ensureQueueSessionState(queue);
    await expireNoShowCalls({ queueId: queue._id });

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
