import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();

/**
 * GET /api/admin/ping — admin-only probe for role enforcement.
 * Queue admin actions land in later tickets; this proves the gate.
 */
router.get("/ping", requireAuth, requireAdmin, (req, res) => {
  res.status(200).json({
    ok: true,
    role: req.user.role,
  });
});

export default router;
