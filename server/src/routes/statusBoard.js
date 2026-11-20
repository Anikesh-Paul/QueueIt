import { Router } from "express";
import { collectStatusBoard, STATUS_BOARD_CACHE_HEADER } from "../services/statusBoard.js";

const router = Router();

/**
 * GET /api/status-board — public, read-only campus wait board.
 * Optional ?org= and ?venue= (id or slug). Never writes.
 */
router.get("/", async (req, res, next) => {
  try {
    const orgKey = typeof req.query.org === "string" ? req.query.org : "";
    const venueKey = typeof req.query.venue === "string" ? req.query.venue : "";
    const result = await collectStatusBoard({ orgKey, venueKey });
    if (!result.ok) {
      res.set("Cache-Control", "no-store");
      return res.status(result.status).json({ error: result.error });
    }
    res.set("Cache-Control", STATUS_BOARD_CACHE_HEADER);
    return res.status(200).json(result.payload);
  } catch (err) {
    return next(err);
  }
});

export default router;
