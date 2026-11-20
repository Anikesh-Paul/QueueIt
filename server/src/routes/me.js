import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { Queue } from "../models/Queue.js";
import { User } from "../models/User.js";
import { favoriteQueueIds, listVisits, MAX_FAVORITE_QUEUES, parseVisitQuery } from "../services/visitHistory.js";

/**
 * Personal data for the signed-in account. Every query is keyed on req.user,
 * so one person can never read or change another's visits or stars.
 */
const router = Router();
router.use(requireAuth);

/** GET /api/me/visits?page=&pageSize=&queue=&from=YYYY-MM-DD&to=YYYY-MM-DD */
router.get("/visits", async (req, res, next) => {
  try {
    const parsed = parseVisitQuery(req.query);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const body = await listVisits(req.user._id, parsed.value);
    return res.status(200).json(body);
  } catch (err) {
    return next(err);
  }
});

/** GET /api/me/favorites → { favorites: [queueId] } */
router.get("/favorites", async (req, res, next) => {
  try {
    return res.status(200).json({ favorites: await favoriteQueueIds(req.user) });
  } catch (err) {
    return next(err);
  }
});

async function respondWithFavorites(res, userId, status = 200) {
  const fresh = await User.findById(userId).select("favoriteQueues");
  return res.status(status).json({ favorites: await favoriteQueueIds(fresh || { favoriteQueues: [] }) });
}

/** PUT /api/me/favorites/:queueId — star a queue (idempotent). */
router.put("/favorites/:queueId", async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) return res.status(400).json({ error: "Invalid queue" });
    const queue = await Queue.exists({ _id: queueId });
    if (!queue) return res.status(404).json({ error: "Queue not found" });
    const current = (req.user.favoriteQueues || []).map(String);
    if (!current.includes(String(queueId))) {
      const live = await favoriteQueueIds(req.user);
      if (live.length >= MAX_FAVORITE_QUEUES) {
        return res.status(409).json({ error: `You can star up to ${MAX_FAVORITE_QUEUES} queues` });
      }
      // Drop stars for removed queues while we are here.
      await User.updateOne({ _id: req.user._id }, { $set: { favoriteQueues: [...live, String(queueId)] } });
    }
    return respondWithFavorites(res, req.user._id);
  } catch (err) {
    return next(err);
  }
});

/** DELETE /api/me/favorites/:queueId — unstar (idempotent). */
router.delete("/favorites/:queueId", async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!mongoose.isValidObjectId(queueId)) return res.status(400).json({ error: "Invalid queue" });
    await User.updateOne({ _id: req.user._id }, { $pull: { favoriteQueues: new mongoose.Types.ObjectId(queueId) } });
    return respondWithFavorites(res, req.user._id);
  } catch (err) {
    return next(err);
  }
});

export default router;
