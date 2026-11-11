import mongoose from "mongoose";
import { AdminAudit } from "../models/AdminAudit.js";
import { Queue } from "../models/Queue.js";
import { Venue } from "../models/Venue.js";
import { isStaff, staffVenueId, VENUE_FORBIDDEN } from "./staffAccess.js";

export const AUDIT_PAGE_DEFAULT = 20;
export const AUDIT_PAGE_MAX = 50;

function asRef(doc, fallbackId = null) {
  if (!doc && !fallbackId) return null;
  if (doc && typeof doc === "object") {
    const id = (doc._id ?? doc.id)?.toString?.() ?? null;
    if (!id) return null;
    return { id, name: doc.name || null };
  }
  const id = fallbackId?.toString?.() ?? (fallbackId ? String(fallbackId) : null);
  return id ? { id, name: null } : null;
}

function actorFromUser(user) {
  if (!user) return null;
  const id = (user._id ?? user.id)?.toString?.();
  if (!id) return null;
  return {
    id,
    name: user.name || null,
    email: user.email || null,
    role: user.role || null,
  };
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Persist one admin action. Failures are logged and swallowed so the
 * operator request still succeeds.
 */
export async function recordAdminAudit({ actor, action, queue = null, venue = null, meta = null } = {}) {
  try {
    const snapshot = actorFromUser(actor);
    const name = typeof action === "string" ? action.trim() : "";
    if (!snapshot || !name) return null;

    let queueRef = asRef(queue);
    let venueRef = asRef(venue);
    if (queue && !venueRef) {
      const venueId = queue.venue?._id ?? queue.venue ?? null;
      if (queue.venue && typeof queue.venue === "object" && queue.venue.name) {
        venueRef = asRef(queue.venue);
      } else if (venueId) {
        const doc = await Venue.findById(venueId).select("name");
        venueRef = asRef(doc, venueId);
      }
    }

    const row = await AdminAudit.create({
      actor: snapshot,
      action: name.slice(0, 64),
      queue: queueRef,
      venue: venueRef,
      meta: sanitizeMeta(meta),
    });
    return row;
  } catch (err) {
    console.error("admin audit write failed:", err?.message || err);
    return null;
  }
}

export function toAuditJSON(row) {
  return {
    id: row._id.toString(),
    action: row.action,
    actor: row.actor,
    queue: row.queue || null,
    venue: row.venue || null,
    meta: row.meta || null,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  };
}

/**
 * Paginated audit read. Staff are locked to their venue; requesting another
 * venue or a queue outside it is 403. Students never reach this (requireAdmin).
 */
export async function listAdminAudit(user, query = {}) {
  if (isStaff(user) && !staffVenueId(user)) {
    return { ok: false, status: 403, error: VENUE_FORBIDDEN };
  }

  let venueId = query.venueId ? String(query.venueId) : null;
  let queueId = query.queueId ? String(query.queueId) : null;
  if (queueId && !mongoose.isValidObjectId(queueId)) {
    return { ok: false, status: 404, error: "Queue not found" };
  }
  if (venueId && !mongoose.isValidObjectId(venueId)) {
    return { ok: false, status: 404, error: "Venue not found" };
  }

  if (queueId) {
    const queue = await Queue.findById(queueId).select("venue name");
    if (!queue) return { ok: false, status: 404, error: "Queue not found" };
    const qVenue = queue.venue?.toString?.();
    if (isStaff(user) && staffVenueId(user) !== qVenue) {
      return { ok: false, status: 403, error: VENUE_FORBIDDEN };
    }
    if (venueId && venueId !== qVenue) {
      return { ok: false, status: 400, error: "That queue is not in the selected venue" };
    }
    venueId = venueId || qVenue;
  }

  if (isStaff(user)) {
    const assigned = staffVenueId(user);
    if (venueId && venueId !== assigned) {
      return { ok: false, status: 403, error: VENUE_FORBIDDEN };
    }
    venueId = assigned;
  }

  const filter = {};
  if (queueId) filter["queue.id"] = queueId;
  if (venueId) filter["venue.id"] = venueId;

  if (query.cursor) {
    if (!mongoose.isValidObjectId(query.cursor)) {
      return { ok: false, status: 400, error: "Invalid cursor" };
    }
    filter._id = { $lt: query.cursor };
  }

  const rawLimit = Number(query.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(AUDIT_PAGE_MAX, Math.max(1, Math.trunc(rawLimit)))
    : AUDIT_PAGE_DEFAULT;

  const rows = await AdminAudit.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .exec();
  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit).map(toAuditJSON);
  return {
    ok: true,
    events,
    hasMore,
    cursor: hasMore ? events[events.length - 1].id : null,
  };
}
