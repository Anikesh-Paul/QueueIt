import crypto from "crypto";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Venue } from "../models/Venue.js";
import { Queue } from "../models/Queue.js";
import {
  isValidEmail,
  normalizeEmail,
  normalizeName,
  passwordError,
} from "./authValidation.js";
import { requestPasswordReset } from "./passwordReset.js";


/**
 * Normalize an optional staff queue allow-list.
 * Empty / omitted means every queue in the venue.
 */
export async function resolveStaffQueueAllowList(venueId, queueIds) {
  if (queueIds == null || (Array.isArray(queueIds) && queueIds.length === 0)) {
    return { ok: true, ids: [] };
  }
  if (!Array.isArray(queueIds)) {
    return { ok: false, status: 400, error: "Queue allow-list must be a list of queue ids" };
  }
  const unique = [...new Set(queueIds.map((id) => String(id).trim()).filter(Boolean))];
  for (const id of unique) {
    if (!mongoose.isValidObjectId(id)) {
      return { ok: false, status: 400, error: "Enter valid queue ids" };
    }
  }
  const queues = await Queue.find({ _id: { $in: unique } });
  if (queues.length !== unique.length) {
    return { ok: false, status: 400, error: "One or more queues were not found" };
  }
  if (queues.some((queue) => String(queue.venue) !== String(venueId))) {
    return { ok: false, status: 400, error: "Queues must belong to the staff member's venue" };
  }
  return { ok: true, ids: unique };
}

function randomTemporaryPassword() {
  return crypto.randomBytes(12).toString("base64url");
}

/**
 * Global admin only: create a venue-scoped staff account.
 * A provided temporary password is stored hashed. If omitted, one is generated
 * and a password-reset link is sent (logged in development).
 */
export async function inviteStaff({ name, email, venueId, temporaryPassword, queueIds } = {}) {
  if (!venueId) return { ok: false, status: 400, error: "Venue is required" };
  const venue = await Venue.findById(venueId);
  if (!venue) return { ok: false, status: 404, error: "Venue not found" };

  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    return { ok: false, status: 400, error: "Enter a valid email address" };
  }
  const named = normalizeName(name);
  if (!named.ok) return { ok: false, status: 400, error: named.error };

  const allowed = await resolveStaffQueueAllowList(venue._id, queueIds);
  if (!allowed.ok) return allowed;

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
    staffQueues: allowed.ids,
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

export async function listStaffAccounts() {
  const staff = await User.find({ role: "staff" }).sort({ name: 1, email: 1 });
  return staff.map((user) => user.toPublicJSON());
}

export async function updateStaffQueues({ staffId, queueIds }) {
  if (!staffId || !mongoose.isValidObjectId(staffId)) {
    return { ok: false, status: 404, error: "Staff member not found" };
  }
  const staff = await User.findById(staffId);
  if (!staff || staff.role !== "staff") {
    return { ok: false, status: 404, error: "Staff member not found" };
  }
  const allowed = await resolveStaffQueueAllowList(staff.staffVenue, queueIds);
  if (!allowed.ok) return allowed;
  staff.staffQueues = allowed.ids;
  await staff.save();
  return { ok: true, user: staff };
}

