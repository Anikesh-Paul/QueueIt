import { Router } from "express";
import { User } from "../models/User.js";
import { Guest } from "../models/Guest.js";
import {
  GUEST_CREDENTIAL_HEADER,
  requireAuth,
  signToken,
} from "../middleware/auth.js";
import { claimGuestOntoUser } from "../services/softUpgrade.js";
import {
  isValidEmail,
  normalizeEmail,
  normalizeName,
  passwordError,
} from "../services/authValidation.js";

const router = Router();

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
    const named = normalizeName(req.body?.name);

    if (!email || password == null || password === "") {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    const passwordProblem = passwordError(password);
    if (passwordProblem) {
      return res.status(400).json({ error: passwordProblem });
    }
    if (!named.ok) {
      return res.status(400).json({ error: named.error });
    }
    const name = named.name;

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

    if (!email || password == null || password === "") {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    if (typeof password !== "string") {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: "Password must be at most 128 characters" });
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
