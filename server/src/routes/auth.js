import { Router } from "express";
import { User } from "../models/User.js";
import { requireAuth, signToken } from "../middleware/auth.js";

const router = Router();

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/** POST /api/auth/register — create a student (user role only). */
router.post("/register", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const name = String(req.body?.name || "").trim() || "User";

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      email,
      name,
      passwordHash,
      role: "user",
    });

    const token = signToken(user);
    return res.status(201).json({
      token,
      user: user.toPublicJSON(),
    });
  } catch (err) {
    return next(err);
  }
});

/** POST /api/auth/login — email/password → JWT session. */
router.post("/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const ok = await user.comparePassword(password);
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(user);
    return res.status(200).json({
      token,
      user: user.toPublicJSON(),
    });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/auth/me — current session user (protected). */
router.get("/me", requireAuth, async (req, res) => {
  return res.status(200).json({ user: req.user.toPublicJSON() });
});

export default router;
