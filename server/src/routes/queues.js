import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { Queue } from "../models/Queue.js";
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
    const queues = await Queue.find({ status: "open" })
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

export default router;
