import { Router } from "express";
import { User } from "../models/User.js";
import { Guest } from "../models/Guest.js";
import {
  GUEST_CREDENTIAL_HEADER,
  requireAuth,
  signToken,
} from "../middleware/auth.js";
import { claimGuestOntoUser } from "../services/softUpgrade.js";

const router = Router();

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/**
 * Soft upgrade: if a non-retired Guest credential is present, claim its
 * memberships + device-local history onto a student User and retire the credential.
 * Admin sessions ignore Guest credentials (JWT wins; claim is student-path only).
 * @returns {Promise<{ claimed: number } | null>}
 */
async function softUpgradeFromRequest(req, user) {
  if (!user || user.role !== "user") return null;

  const raw = req.headers[GUEST_CREDENTIAL_HEADER];
  if (!raw || typeof raw !== "string") return null;
  const credential = raw.trim();
  if (!credential) return null;

  const guest = await Guest.findOne({ credential, retiredAt: null });
  if (!guest) return null;

  return claimGuestOntoUser(guest, user);
}

/** POST /api/auth/register — create a student (user role only); optional soft upgrade. */
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

    const softUpgrade = await softUpgradeFromRequest(req, user);

    const token = signToken(user);
    const body = {
      token,
      user: user.toPublicJSON(),
    };
    if (softUpgrade) {
      body.softUpgrade = softUpgrade;
    }
    return res.status(201).json(body);
  } catch (err) {
    return next(err);
  }
});

/** POST /api/auth/login — email/password → JWT session; optional soft upgrade. */
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

    const softUpgrade = await softUpgradeFromRequest(req, user);

    const token = signToken(user);
    const body = {
      token,
      user: user.toPublicJSON(),
    };
    if (softUpgrade) {
      body.softUpgrade = softUpgrade;
    }
    return res.status(200).json(body);
  } catch (err) {
    return next(err);
  }
});

/** GET /api/auth/me — current session user (protected). */
router.get("/me", requireAuth, async (req, res) => {
  return res.status(200).json({ user: req.user.toPublicJSON() });
});

export default router;
