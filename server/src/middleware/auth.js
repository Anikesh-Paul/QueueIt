import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

function getJwtSecret() {
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
 * Require a valid Bearer JWT. Attaches `req.user` (public user fields).
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    let payload;
    try {
      payload = jwt.verify(token, getJwtSecret());
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const user = await User.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
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
