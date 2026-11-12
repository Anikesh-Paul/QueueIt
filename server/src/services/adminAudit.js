import mongoose from "mongoose";
import { AdminAudit } from "../models/AdminAudit.js";
import { Queue } from "../models/Queue.js";
import { Venue } from "../models/Venue.js";
import { campusLocalToUtc, parseCampusDate } from "./serviceWindows.js";
import { canAccessQueue, isStaff, staffQueueIds, staffVenueId, QUEUE_FORBIDDEN, VENUE_FORBIDDEN } from "./staffAccess.js";

export const AUDIT_PAGE_DEFAULT = 20;
export const AUDIT_PAGE_MAX = 50;
export const AUDIT_EXPORT_MAX = 5000;

/** Action groups for the audit log filter. Anything unlisted lands in "other". */
export const AUDIT_CATEGORIES = {
  operations: ["serve", "call", "skip", "walk-in", "reset", "pause", "resume", "stop-accepting", "start-accepting", "rejoin"],
  settings: [
    "queue-update", "queue-create", "queue-archive", "queue-restore", "service-windows",
    "venue-create", "venue-rename", "counter-add", "counter-rename", "counter-remove",
  ],
  staff: ["staff-invite", "staff-access", "shift-start", "shift-break", "shift-back", "shift-end", "shift-open", "shift-close"],
  notices: ["announcement-post", "announcement-edit", "announcement-end"],
  bookings: ["appointment-book", "appointment-checkin", "priority-set", "priority-approve", "priority-reject", "priority-request"],
};

export function auditCategoryOf(action) {
  for (const [key, list] of Object.entries(AUDIT_CATEGORIES)) if (list.includes(action)) return key;
  return "other";
}

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
 * Build the Mongo filter for an audit read. Staff are locked to their venue;
 * requesting another venue or a queue outside it is 403. Students never reach
 * this (requireAdmin).
 */
async function buildAuditFilter(user, query = {}) {
  if (isStaff(user) && !staffVenueId(user)) {
    return { ok: false, status: 403, error: VENUE_FORBIDDEN };
  }

  let venueId = query.venueId ? String(query.venueId) : null;
  const queueId = query.queueId ? String(query.queueId) : null;
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
    if (isStaff(user) && !canAccessQueue(user, queue)) {
      return { ok: false, status: 403, error: QUEUE_FORBIDDEN };
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
  const allowedQueues = staffQueueIds(user);
  if (allowedQueues && !queueId) {
    filter["queue.id"] = { $in: allowedQueues };
  }

  const category = query.category ? String(query.category) : "";
  if (category) {
    if (category === "other") {
      filter.action = { $nin: Object.values(AUDIT_CATEGORIES).flat() };
    } else if (AUDIT_CATEGORIES[category]) {
      filter.action = { $in: AUDIT_CATEGORIES[category] };
    } else {
      return { ok: false, status: 400, error: "Unknown kind of action" };
    }
  }
  if (query.action) filter.action = String(query.action);
  if (query.actorId) filter["actor.id"] = String(query.actorId);

  const range = {};
  for (const [key, op, hour, minute, second] of [
    ["from", "$gte", 0, 0, 0],
    ["to", "$lte", 23, 59, 59],
  ]) {
    if (!query[key]) continue;
    const day = parseCampusDate(String(query[key]));
    if (!day) return { ok: false, status: 400, error: `Pick a valid ${key === "from" ? "start" : "end"} date` };
    range[op] = campusLocalToUtc(day.year, day.month, day.day, hour, minute, second);
    if (op === "$lte") range[op] = new Date(range[op].getTime() + 999);
  }
  if (range.$gte && range.$lte && range.$gte > range.$lte) {
    return { ok: false, status: 400, error: "The start date is after the end date" };
  }
  if (Object.keys(range).length) filter.createdAt = range;

  return { ok: true, filter };
}

/** Paginated audit read with filters (category, action, actorId, from, to). */
export async function listAdminAudit(user, query = {}) {
  const built = await buildAuditFilter(user, query);
  if (!built.ok) return built;
  const { filter } = built;

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

/** People who appear in the log I can see, for the "who" filter. */
export async function listAuditActors(user) {
  const built = await buildAuditFilter(user, {});
  if (!built.ok) return built;
  const rows = await AdminAudit.aggregate([
    { $match: built.filter },
    { $sort: { _id: -1 } },
    {
      $group: {
        _id: "$actor.id",
        name: { $first: "$actor.name" },
        email: { $first: "$actor.email" },
        role: { $first: "$actor.role" },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 100 },
  ]);
  return {
    ok: true,
    actors: rows.map((r) => ({ id: r._id, name: r.name || null, email: r.email || null, role: r.role || null, count: r.count })),
  };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  // Neutralise spreadsheet formulas, then quote.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) || safe !== text ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function campusStamp(date) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const g = (t) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

/** CSV of the filtered log, newest first, capped at AUDIT_EXPORT_MAX rows. */
export async function exportAdminAuditCsv(user, query = {}) {
  const built = await buildAuditFilter(user, query);
  if (!built.ok) return built;
  const rows = await AdminAudit.find(built.filter).sort({ _id: -1 }).limit(AUDIT_EXPORT_MAX).lean();
  const header = ["time_ist", "action", "kind", "who", "who_email", "role", "venue", "queue", "details"];
  const lines = [header.join(",")];
  for (const row of rows) {
    const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
    const details = Object.entries(meta)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    lines.push(
      [
        campusStamp(new Date(row.createdAt)),
        row.action,
        auditCategoryOf(row.action),
        row.actor?.name,
        row.actor?.email,
        row.actor?.role,
        row.venue?.name,
        row.queue?.name,
        details,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return { ok: true, csv: `${lines.join("\n")}\n`, count: rows.length, truncated: rows.length === AUDIT_EXPORT_MAX };
}
