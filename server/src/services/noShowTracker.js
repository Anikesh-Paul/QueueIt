/**
 * No-show tracking: who keeps missing their call.
 *
 * A no-show is a called (serving) ticket that ended skipped, either because the
 * grace period ran out (skipReason "no-show") or because staff skipped it while
 * it was called (skipReason "staff"). New rows stamp noShowAt and bump noShows,
 * which both survive a missed-turn rejoin (so a rejoined ticket that misses
 * again counts twice). Rows written before this feature have no noShowAt, so a
 * skipped row with a calledAt counts once. Nothing here writes old rows.
 */
import mongoose from "mongoose";
import { QueueEntry } from "../models/QueueEntry.js";
import { AdminAudit } from "../models/AdminAudit.js";
import { User } from "../models/User.js";
import { recordAdminAudit } from "./adminAudit.js";
import { now as clockNow } from "./clock.js";

/** No-shows within the window that mark someone as a frequent no-show. */
export const FREQUENT_NO_SHOW_THRESHOLD = 3;
export const NO_SHOW_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Actor recorded on audit rows the system writes by itself. */
export const SYSTEM_ACTOR = { _id: "system", name: "QueueIt (automatic)", email: null, role: "system" };

export function noShowWindowStart(at = clockNow()) {
  return new Date(at.getTime() - NO_SHOW_WINDOW_DAYS * DAY_MS);
}

/** Mongo filter for no-show rows since a date (new stamped rows plus legacy rows). */
export function noShowMatch(since) {
  return {
    $or: [
      { noShowAt: { $gte: since } },
      {
        noShowAt: null,
        status: "skipped",
        calledAt: { $ne: null },
        skippedAt: { $gte: since },
      },
    ],
  };
}

/** Per-row weight: stamped rows carry their own count; legacy rows count once. */
const NO_SHOW_WEIGHT = { $max: [{ $ifNull: ["$noShows", 0] }, 1] };

export function isFrequentNoShow(count) {
  return Number(count) >= FREQUENT_NO_SHOW_THRESHOLD;
}

function identityOf(entry) {
  if (!entry || entry.isWalkIn) return null;
  const user = entry.user?._id ?? entry.user;
  if (user) return { kind: "user", id: String(user) };
  const guest = entry.guest?._id ?? entry.guest;
  if (guest) return { kind: "guest", id: String(guest) };
  return null;
}

/** No-shows in the window for one user or guest. */
export async function countNoShows(identity, at = clockNow()) {
  if (!identity?.id || !mongoose.isValidObjectId(identity.id)) return 0;
  const field = identity.kind === "guest" ? "guest" : "user";
  const rows = await QueueEntry.aggregate([
    { $match: { $and: [{ [field]: new mongoose.Types.ObjectId(identity.id) }, noShowMatch(noShowWindowStart(at))] } },
    { $group: { _id: null, count: { $sum: NO_SHOW_WEIGHT } } },
  ]);
  return rows[0]?.count ?? 0;
}

export async function countNoShowsForEntry(entry, at = clockNow()) {
  return countNoShows(identityOf(entry), at);
}

/**
 * Batch counts for many entries. Returns Map keyed "user:<id>" / "guest:<id>".
 */
export async function noShowCountsForEntries(entries, at = clockNow()) {
  const users = new Set();
  const guests = new Set();
  for (const entry of entries || []) {
    const ident = identityOf(entry);
    if (!ident) continue;
    (ident.kind === "user" ? users : guests).add(ident.id);
  }
  const counts = new Map();
  if (users.size === 0 && guests.size === 0) return counts;
  const since = noShowWindowStart(at);
  const or = [];
  if (users.size) or.push({ user: { $in: [...users].map((id) => new mongoose.Types.ObjectId(id)) } });
  if (guests.size) or.push({ guest: { $in: [...guests].map((id) => new mongoose.Types.ObjectId(id)) } });
  const rows = await QueueEntry.aggregate([
    { $match: { $and: [{ $or: or }, noShowMatch(since)] } },
    { $group: { _id: { user: "$user", guest: "$guest" }, count: { $sum: NO_SHOW_WEIGHT } } },
  ]);
  for (const row of rows) {
    if (row._id.user) counts.set(`user:${row._id.user}`, row.count);
    else if (row._id.guest) counts.set(`guest:${row._id.guest}`, row.count);
  }
  return counts;
}

export function noShowFieldsFromCounts(entry, counts) {
  const ident = identityOf(entry);
  if (!ident) return { noShowCount: 0, frequentNoShow: false };
  const count = counts?.get(`${ident.kind}:${ident.id}`) ?? 0;
  return { noShowCount: count, frequentNoShow: isFrequentNoShow(count) };
}

/**
 * After a called ticket ends skipped: write the audit row for an automatic
 * no-show and, the first time someone reaches the threshold in the window,
 * a "no-show-flag" row. Safe to call twice for the same entry.
 */
export async function recordNoShow({ entry, queue, reason = "no-show", at = clockNow() }) {
  try {
    if (!entry) return { count: 0, flagged: false };
    if (reason === "no-show") {
      await recordAdminAudit({
        actor: SYSTEM_ACTOR,
        action: "no-show",
        queue,
        meta: { tokenNumber: entry.tokenNumber, graceMinutes: entry.noShowWindowMinutes ?? null },
      });
    }
    const ident = identityOf(entry);
    if (!ident) return { count: 0, flagged: false };
    const count = await countNoShows(ident, at);
    if (!isFrequentNoShow(count)) return { count, flagged: false };

    const subjectKey = `${ident.kind}:${ident.id}`;
    const already = await AdminAudit.exists({
      action: "no-show-flag",
      "meta.subject": subjectKey,
      createdAt: { $gte: noShowWindowStart(at) },
    });
    if (already) return { count, flagged: false };

    let label = ident.kind === "guest" ? `Guest ticket #${entry.tokenNumber}` : null;
    if (ident.kind === "user") {
      const user = await User.findById(ident.id).select("name email").lean();
      label = user ? `${user.name || "Student"}${user.email ? ` (${user.email})` : ""}` : "Student";
    }
    await recordAdminAudit({
      actor: SYSTEM_ACTOR,
      action: "no-show-flag",
      queue,
      meta: {
        subject: subjectKey,
        person: label,
        tokenNumber: entry.tokenNumber,
        noShows: count,
        windowDays: NO_SHOW_WINDOW_DAYS,
      },
    });
    return { count, flagged: true };
  } catch (err) {
    console.error("no-show tracking failed:", err?.message || err);
    return { count: 0, flagged: false };
  }
}

/**
 * People at or over the threshold whose no-shows happened in these queues.
 * Admin/staff analytics only.
 */
export async function listFrequentNoShows(queueIds, at = clockNow(), { limit = 20 } = {}) {
  if (!queueIds?.length) return [];
  const since = noShowWindowStart(at);
  const rows = await QueueEntry.aggregate([
    { $match: { $and: [{ queue: { $in: queueIds }, isWalkIn: { $ne: true } }, noShowMatch(since)] } },
    { $sort: { updatedAt: 1 } },
    {
      $group: {
        _id: { user: "$user", guest: "$guest" },
        count: { $sum: NO_SHOW_WEIGHT },
        lastAt: { $max: { $ifNull: ["$noShowAt", "$skippedAt"] } },
        lastToken: { $last: "$tokenNumber" },
      },
    },
    { $match: { count: { $gte: FREQUENT_NO_SHOW_THRESHOLD } } },
    { $sort: { count: -1, lastAt: -1 } },
    { $limit: limit },
  ]);
  const userIds = rows.map((row) => row._id.user).filter(Boolean);
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select("name email").lean() : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return rows.map((row) => {
    const user = row._id.user ? byId.get(String(row._id.user)) : null;
    return {
      kind: row._id.user ? "user" : "guest",
      name: row._id.user ? user?.name || "Student" : `Guest (last ticket #${row.lastToken})`,
      email: user?.email || null,
      noShows: row.count,
      lastNoShowAt: row.lastAt ? new Date(row.lastAt).toISOString() : null,
    };
  });
}
