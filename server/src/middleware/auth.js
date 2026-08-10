import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { Guest } from "../models/Guest.js";

/** Header carrying the device-bound Guest credential (implementer choice). */
export const GUEST_CREDENTIAL_HEADER = "x-guest-credential";

/** JWT secret from env (throws when unset). Shared by REST auth and socket auth. */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }
  return secret;
}

/** Sign a session token for the given user document. */
export function signToken(user) {
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      email: user.email,
    },
    getJwtSecret(),
    { expiresIn }
  );
}

/**
 * Resolve Bearer JWT → `req.user` when present. Does not 401 on missing auth.
 * Invalid/expired Bearer still 401 so callers do not silently fall through.
 */
async function attachUserFromBearer(req, res) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return { ok: true, attached: false };
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return { ok: false };
  }

  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return { ok: false };
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return { ok: false };
  }

  req.user = user;
  return { ok: true, attached: true };
}

/**
 * Resolve Guest credential header → `req.guest` when present and not retired.
 * Unknown / retired credentials are ignored (caller may mint on join).
 */
async function attachGuestFromHeader(req) {
  const raw = req.headers[GUEST_CREDENTIAL_HEADER];
  if (!raw || typeof raw !== "string") return;
  const credential = raw.trim();
  if (!credential) return;

  const guest = await Guest.findOne({ credential, retiredAt: null });
  if (guest) {
    req.guest = guest;
  }
}

/**
 * Require a valid Bearer JWT. Attaches `req.user`.
 */
export async function requireAuth(req, res, next) {
  try {
    const result = await attachUserFromBearer(req, res);
    if (!result.ok) return;
    if (!result.attached) {
      return res.status(401).json({ error: "Authentication required" });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Attach JWT user and/or Guest identity for student join path.
 * JWT wins when both are present (Guest credential ignored while logged in).
 */
export async function attachJoiner(req, res, next) {
  try {
    const result = await attachUserFromBearer(req, res);
    if (!result.ok) return;
    if (!req.user) {
      await attachGuestFromHeader(req);
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Require an authenticated User **or** a recognized Guest for leave/status/history.
 * Join itself may mint a Guest and uses `attachJoiner` without this gate.
 */
export function requireJoiner(req, res, next) {
  if (req.user || req.guest) {
    return next();
  }
  return res.status(401).json({ error: "Authentication required" });
}

/**
 * Require `req.user.role === "admin"`. Use after `requireAuth`.
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}
