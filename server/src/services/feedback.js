import mongoose from "mongoose";
import { Feedback } from "../models/Feedback.js";
import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";

/** People can rate a visit for this long after being served. */
export const FEEDBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** The queues page only nudges for visits served within this window. */
export const FEEDBACK_PROMPT_MS = 24 * 60 * 60 * 1000;
export const COMMENT_MAX = 500;

function ownerFilter(joiner) {
  if (joiner?.user) return { user: joiner.user._id };
  if (joiner?.guest) return { guest: joiner.guest._id };
  return null;
}

function counterNameFor(queue, counterId) {
  if (!queue || !counterId) return null;
  const counter = (queue.counters || []).find((row) => String(row._id) === String(counterId));
  return counter?.name || null;
}

function servedAtOf(entry) {
  return entry.servedAt || entry.updatedAt || null;
}

/** Validate { rating, comment } from the client. */
export function cleanFeedbackInput(body = {}) {
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Rating must be a whole number from 1 to 5" };
  }
  const raw = body.comment == null ? "" : body.comment;
  if (typeof raw !== "string") return { ok: false, error: "Comment must be text" };
  const comment = raw.replace(/\s+/g, " ").trim();
  if (comment.length > COMMENT_MAX) {
    return { ok: false, error: `Keep comments under ${COMMENT_MAX} characters` };
  }
  return { ok: true, rating, comment };
}

/**
 * Served tickets still waiting for a rating (newest first).
 */
export async function pendingFeedback(joiner, { at = clockNow(), windowMs = FEEDBACK_PROMPT_MS, limit = 3 } = {}) {
  const owner = ownerFilter(joiner);
  if (!owner) return [];
  const since = new Date(at.getTime() - windowMs);
  const entries = await QueueEntry.find({
    ...owner,
    status: "served",
    $or: [{ servedAt: { $gte: since } }, { servedAt: null, updatedAt: { $gte: since } }],
  })
    .populate("queue")
    .sort({ servedAt: -1, updatedAt: -1 })
    .limit(20);
  if (!entries.length) return [];
  const rated = new Set(
    (await Feedback.find({ entry: { $in: entries.map((e) => e._id) } }).select("entry")).map((f) => String(f.entry))
  );
  return entries
    .filter((entry) => entry.queue && !rated.has(String(entry._id)))
    .slice(0, limit)
    .map((entry) => ({
      entryId: String(entry._id),
      queue: { id: String(entry.queue._id), name: entry.queue.name },
      tokenNumber: entry.tokenNumber,
      servedAt: servedAtOf(entry)?.toISOString?.() ?? null,
      counterName: counterNameFor(entry.queue, entry.servingCounterId),
    }));
}

/**
 * Save one rating for one of the joiner's served tickets.
 * @returns {Promise<{ ok: true, feedback: object } | { ok: false, status: number, error: string, code?: string }>}
 */
export async function submitFeedback(joiner, body = {}, { at = clockNow() } = {}) {
  const owner = ownerFilter(joiner);
  if (!owner) return { ok: false, status: 401, error: "Sign in or join as a guest first" };
  const entryId = body.entryId;
  if (!entryId || !mongoose.isValidObjectId(entryId)) {
    return { ok: false, status: 404, error: "We couldn't find that visit" };
  }
  const input = cleanFeedbackInput(body);
  if (!input.ok) return { ok: false, status: 400, error: input.error };

  const entry = await QueueEntry.findOne({ _id: entryId, ...owner }).populate("queue");
  if (!entry || !entry.queue) return { ok: false, status: 404, error: "We couldn't find that visit" };
  if (entry.status !== "served") {
    return { ok: false, status: 409, error: "You can rate a visit once you've been served", code: "not-served" };
  }
  const servedAt = servedAtOf(entry);
  if (servedAt && at.getTime() - new Date(servedAt).getTime() > FEEDBACK_WINDOW_MS) {
    return { ok: false, status: 409, error: "Ratings close 7 days after a visit", code: "too-late" };
  }

  try {
    const doc = await Feedback.create({
      queue: entry.queue._id,
      venue: entry.queue.venue?._id ?? entry.queue.venue ?? null,
      entry: entry._id,
      user: owner.user ?? null,
      guest: owner.guest ?? null,
      counterId: entry.servingCounterId ?? null,
      counterName: counterNameFor(entry.queue, entry.servingCounterId),
      tokenNumber: entry.tokenNumber,
      rating: input.rating,
      comment: input.comment,
      servedAt,
    });
    return { ok: true, feedback: toFeedbackJSON(doc) };
  } catch (err) {
    if (err?.code === 11000) {
      return { ok: false, status: 409, error: "You've already rated this visit", code: "already-rated" };
    }
    throw err;
  }
}

export function toFeedbackJSON(doc) {
  return {
    id: String(doc._id),
    entryId: String(doc.entry),
    queueId: String(doc.queue),
    rating: doc.rating,
    comment: doc.comment || "",
    counterName: doc.counterName || null,
    createdAt: doc.createdAt?.toISOString?.() ?? null,
  };
}

/** entryId → { rating } for a page of history rows. */
export async function feedbackByEntry(entryIds) {
  if (!entryIds.length) return new Map();
  const rows = await Feedback.find({ entry: { $in: entryIds } }).select("entry rating");
  return new Map(rows.map((row) => [String(row.entry), { rating: row.rating }]));
}

/**
 * Rating summary for the analytics report: per queue, per counter, and the
 * latest comments. Window is by the time the rating was left.
 */
export async function feedbackSummary(queueIds, { start, end }, { commentLimit = 6 } = {}) {
  const empty = { totals: { ratings: 0, averageRating: null }, byQueue: new Map(), counters: [], comments: [] };
  if (!queueIds.length) return empty;
  const match = { queue: { $in: queueIds }, createdAt: { $gte: start, $lt: end } };
  const [byQueue, byCounter, comments] = await Promise.all([
    Feedback.aggregate([
      { $match: match },
      { $group: { _id: "$queue", ratings: { $sum: 1 }, sum: { $sum: "$rating" } } },
    ]),
    Feedback.aggregate([
      { $match: match },
      {
        $group: {
          _id: { queue: "$queue", counter: { $ifNull: ["$counterName", "Main counter"] } },
          ratings: { $sum: 1 },
          sum: { $sum: "$rating" },
          low: { $sum: { $cond: [{ $lte: ["$rating", 2] }, 1, 0] } },
        },
      },
    ]),
    Feedback.find({ ...match, comment: { $ne: "" } })
      .sort({ createdAt: -1 })
      .limit(commentLimit)
      .select("queue counterName rating comment createdAt"),
  ]);
  const avg = (sum, n) => (n ? Math.round((sum / n) * 10) / 10 : null);
  const total = byQueue.reduce((acc, row) => ({ n: acc.n + row.ratings, sum: acc.sum + row.sum }), { n: 0, sum: 0 });
  return {
    totals: { ratings: total.n, averageRating: avg(total.sum, total.n) },
    byQueue: new Map(byQueue.map((row) => [String(row._id), { ratings: row.ratings, averageRating: avg(row.sum, row.ratings) }])),
    counters: byCounter.map((row) => ({
      queueId: String(row._id.queue),
      counter: row._id.counter,
      ratings: row.ratings,
      averageRating: avg(row.sum, row.ratings),
      lowRatings: row.low,
    })),
    comments: comments.map((row) => ({
      queueId: String(row.queue),
      counter: row.counterName || null,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.createdAt?.toISOString?.() ?? null,
    })),
  };
}
