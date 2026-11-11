import crypto from "crypto";
import { User } from "../models/User.js";
import { Venue } from "../models/Venue.js";
import {
  isValidEmail,
  normalizeEmail,
  normalizeName,
  passwordError,
} from "./authValidation.js";
import { requestPasswordReset } from "./passwordReset.js";

function randomTemporaryPassword() {
  return crypto.randomBytes(12).toString("base64url");
}

/**
 * Global admin only: create a venue-scoped staff account.
 * A provided temporary password is stored hashed. If omitted, one is generated
 * and a password-reset link is sent (logged in development).
 */
export async function inviteStaff({ name, email, venueId, temporaryPassword }) {
  if (!venueId) return { ok: false, status: 400, error: "Venue is required" };
  const venue = await Venue.findById(venueId);
  if (!venue) return { ok: false, status: 404, error: "Venue not found" };

  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    return { ok: false, status: 400, error: "Enter a valid email address" };
  }
  const named = normalizeName(name);
  if (!named.ok) return { ok: false, status: 400, error: named.error };

  const existing = await User.findOne({ email: normalized });
  if (existing) return { ok: false, status: 409, error: "Email already registered" };

  let password = temporaryPassword;
  let generated = false;
  if (password == null || password === "") {
    password = randomTemporaryPassword();
    generated = true;
  }
  const problem = passwordError(password);
  if (problem) return { ok: false, status: 400, error: problem };

  const user = await User.create({
    email: normalized,
    name: named.name,
    passwordHash: await User.hashPassword(password),
    role: "staff",
    staffVenue: venue._id,
  });

  if (generated) {
    await requestPasswordReset(normalized);
  }

  return {
    ok: true,
    user,
    venue,
    temporaryPassword: password,
    resetSent: generated,
  };
}
