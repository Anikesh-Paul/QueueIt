import mongoose from "mongoose";
import { QueueEntry } from "../models/QueueEntry.js";
import { Queue } from "../models/Queue.js";
import { Feedback } from "../models/Feedback.js";
import { campusLocalToUtc } from "./serviceWindows.js";

export const VISITS_DEFAULT_PAGE_SIZE = 10;
export const VISITS_MAX_PAGE_SIZE = 50;
export const MAX_FAVORITE_QUEUES = 20;
const TOP_QUEUES = 3;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Outcome a student sees for one ticket. Older skipped rows have no reason;
 * only staff skips are recorded as such, so a reasonless skip is a no-show.
 */
export function visitOutcome(entry) {
  switch (entry.status) {
    case "waiting":
    case "serving":
      return "active";
    case "served":
      return "served";
    case "left":
      return "left";
    case "skipped":
      return entry.skipReason === "staff" ? "skipped" : "no-show";
    default:
      return entry.status;
  }
}

/** Minutes from joining to being called (served time if it was never "called"). Null when unknown. */
export function visitWaitMinutes(entry) {
  const start = entry.createdAt ? new Date(entry.createdAt).getTime() : NaN;
  const endRaw = entry.calledAt || entry.servedAt;
  const end = endRaw ? new Date(endRaw).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60_000);
}

function parseCampusDay(raw) {
  const m = DAY_RE.exec(String(raw).trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

function nextDay({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function positiveInt(raw, fallback, max) {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return max ? Math.min(n, max) : n;
}

/**
 * Validate visit filters. `from` / `to` are campus (IST) calendar days, both inclusive.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parseVisitQuery(query = {}) {
  const page = positiveInt(query.page, 1);
  if (page == null) return { ok: false, error: "page must be a positive whole number" };
  const pageSize = positiveInt(query.pageSize, VISITS_DEFAULT_PAGE_SIZE, VISITS_MAX_PAGE_SIZE);
  if (pageSize == null) return { ok: false, error: "pageSize must be a positive whole number" };

  let queueId = null;
  if (query.queue != null && String(query.queue).trim() !== "") {
    queueId = String(query.queue).trim();
    if (!mongoose.isValidObjectId(queueId)) return { ok: false, error: "Invalid queue" };
  }

  let from = null;
  let to = null;
  let fromDay = null;
  let toDay = null;
  if (query.from != null && String(query.from).trim() !== "") {
    fromDay = parseCampusDay(query.from);
    if (!fromDay) return { ok: false, error: "from must be a date like 2026-11-20" };
    from = campusLocalToUtc(fromDay.year, fromDay.month, fromDay.day, 0, 0, 0);
  }
  if (query.to != null && String(query.to).trim() !== "") {
    toDay = parseCampusDay(query.to);
    if (!toDay) return { ok: false, error: "to must be a date like 2026-11-20" };
    const end = nextDay(toDay);
    to = campusLocalToUtc(end.year, end.month, end.day, 0, 0, 0);
  }
  if (from && to && to <= from) return { ok: false, error: "to must be on or after from" };

  return {
    ok: true,
    value: {
      page,
      pageSize,
      queueId,
      from,
      to,
      fromLabel: fromDay ? String(query.from).trim() : null,
      toLabel: toDay ? String(query.to).trim() : null,
    },
  };
}

/** Mongo filter for one user's tickets. Always scoped by user id. */
export function visitFilter(userId, { queueId = null, from = null, to = null } = {}) {
  const filter = { user: new mongoose.Types.ObjectId(String(userId)) };
  if (queueId) filter.queue = new mongoose.Types.ObjectId(String(queueId));
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lt = to;
  }
  return filter;
}

async function queueNames(ids) {
  if (!ids.length) return new Map();
  const rows = await Queue.find({ _id: { $in: ids } }).select("name").lean();
  return new Map(rows.map((q) => [String(q._id), q.name]));
}

/** Totals, average wait (served visits) and most-used queues for a filter. */
export async function visitSummary(filter) {
  const [totals] = await QueueEntry.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        served: { $sum: { $cond: [{ $eq: ["$status", "served"] }, 1, 0] } },
        left: { $sum: { $cond: [{ $eq: ["$status", "left"] }, 1, 0] } },
        noShows: {
          $sum: {
            $cond: [{ $and: [{ $eq: ["$status", "skipped"] }, { $ne: ["$skipReason", "staff"] }] }, 1, 0],
          },
        },
        active: { $sum: { $cond: [{ $in: ["$status", ["waiting", "serving"]] }, 1, 0] } },
        waitMsTotal: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "served"] },
                  { $gte: [{ $ifNull: ["$calledAt", "$servedAt"] }, "$createdAt"] },
                ],
              },
              { $subtract: [{ $ifNull: ["$calledAt", "$servedAt"] }, "$createdAt"] },
              0,
            ],
          },
        },
        waitCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "served"] },
                  { $ne: [{ $ifNull: ["$calledAt", "$servedAt"] }, null] },
                  { $gte: [{ $ifNull: ["$calledAt", "$servedAt"] }, "$createdAt"] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  const top = await QueueEntry.aggregate([
    { $match: filter },
    { $group: { _id: "$queue", visits: { $sum: 1 }, lastAt: { $max: "$createdAt" } } },
    { $sort: { visits: -1, lastAt: -1 } },
    { $limit: TOP_QUEUES },
  ]);
  const names = await queueNames(top.map((row) => row._id));
  const t = totals || { total: 0, served: 0, left: 0, noShows: 0, active: 0, waitMsTotal: 0, waitCount: 0 };
  return {
    totalVisits: t.total,
    served: t.served,
    noShows: t.noShows,
    left: t.left,
    active: t.active,
    averageWaitMinutes: t.waitCount ? Math.round(t.waitMsTotal / t.waitCount / 60_000) : null,
    topQueues: top.map((row) => ({
      id: String(row._id),
      name: names.get(String(row._id)) || null,
      visits: row.visits,
    })),
  };
}

/** Every queue this user has a ticket in (for the filter picker), most visits first. */
export async function visitedQueues(userId) {
  const rows = await QueueEntry.aggregate([
    { $match: visitFilter(userId) },
    { $group: { _id: "$queue", visits: { $sum: 1 } } },
    { $sort: { visits: -1 } },
  ]);
  const names = await queueNames(rows.map((row) => row._id));
  return rows.map((row) => ({ id: String(row._id), name: names.get(String(row._id)) || null, visits: row.visits }));
}

function iso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function toVisitJSON(entry, names, feedback) {
  const queueId = String(entry.queue?._id ?? entry.queue);
  const outcome = visitOutcome(entry);
  const endedAt =
    outcome === "served"
      ? iso(entry.servedAt) || iso(entry.updatedAt)
      : outcome === "no-show" || outcome === "skipped"
        ? iso(entry.skippedAt) || iso(entry.updatedAt)
        : outcome === "left"
          ? iso(entry.updatedAt)
          : null;
  return {
    id: String(entry._id),
    queue: { id: queueId, name: names.get(queueId) || null },
    tokenNumber: entry.tokenNumber,
    status: entry.status,
    outcome,
    joinSource: entry.joinSource || "app",
    joinedAt: iso(entry.createdAt),
    calledAt: iso(entry.calledAt),
    endedAt,
    waitMinutes: visitWaitMinutes(entry),
    feedback: feedback ? { rating: feedback.rating, comment: feedback.comment || "" } : null,
  };
}

/** One page of a user's visits plus summary stats for the same filter. */
export async function listVisits(userId, query) {
  const filter = visitFilter(userId, query);
  const total = await QueueEntry.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const entries = await QueueEntry.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((query.page - 1) * query.pageSize)
    .limit(query.pageSize)
    .lean();
  const [names, ratings, summary, queues] = await Promise.all([
    queueNames([...new Set(entries.map((e) => String(e.queue)))]),
    entries.length
      ? Feedback.find({ entry: { $in: entries.map((e) => e._id) } }).select("entry rating comment").lean()
      : [],
    visitSummary(filter),
    visitedQueues(userId),
  ]);
  const byEntry = new Map(ratings.map((row) => [String(row.entry), row]));
  return {
    visits: entries.map((e) => toVisitJSON(e, names, byEntry.get(String(e._id)))),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages,
    summary,
    queues,
    filters: { queue: query.queueId, from: query.fromLabel, to: query.toLabel },
  };
}

/** Starred queue ids that still exist (removed queues drop out quietly). */
export async function favoriteQueueIds(user) {
  const ids = (user.favoriteQueues || []).map(String);
  if (!ids.length) return [];
  const existing = await Queue.find({ _id: { $in: ids } }).select("_id").lean();
  const keep = new Set(existing.map((q) => String(q._id)));
  return ids.filter((id) => keep.has(id));
}
