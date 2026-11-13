/**
 * Admin analytics report: a campus-day range with a daily served series,
 * 24 hourly buckets, no-show rate, and per-queue wait / no-show rows.
 *
 * Campus time is Asia/Kolkata (fixed UTC+05:30, no DST), so a campus day is
 * [YYYY-MM-DDT00:00+05:30, next day 00:00+05:30).
 */
import mongoose from "mongoose";
import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";
import { feedbackSummary } from "./feedback.js";
import { FREQUENT_NO_SHOW_THRESHOLD, NO_SHOW_WINDOW_DAYS, listFrequentNoShows } from "./noShowTracker.js";
import {
  QUEUE_FORBIDDEN,
  VENUE_FORBIDDEN,
  canAccessQueue,
  isStaff,
  resolveVenueFilter,
  staffQueueIds,
} from "./staffAccess.js";

export const CAMPUS_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const MAX_REPORT_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Campus calendar date (YYYY-MM-DD) for an instant. */
export function campusDateOf(at) {
  return new Date(at.getTime() + CAMPUS_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instant for 00:00 campus time on a YYYY-MM-DD date, or null if invalid. */
export function campusDayStart(dateString) {
  const match = DATE_RE.exec(String(dateString || "").trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return new Date(utc - CAMPUS_OFFSET_MS);
}

/**
 * Resolve `from` / `to` campus dates (inclusive). Defaults to the last 7
 * campus days ending today.
 *
 * @returns {{ ok: true, fromDate: string, toDate: string, start: Date, end: Date, days: string[] } | { ok: false, error: string }}
 */
export function resolveReportRange(query = {}, at = clockNow()) {
  const today = campusDateOf(at);
  const rawTo = query.to != null && String(query.to).trim() !== "" ? String(query.to).trim() : today;
  const toStart = campusDayStart(rawTo);
  if (!toStart) return { ok: false, error: "to must be a date (YYYY-MM-DD)" };

  let fromStart;
  if (query.from != null && String(query.from).trim() !== "") {
    fromStart = campusDayStart(String(query.from).trim());
    if (!fromStart) return { ok: false, error: "from must be a date (YYYY-MM-DD)" };
  } else {
    fromStart = new Date(toStart.getTime() - 6 * DAY_MS);
  }
  if (fromStart.getTime() > toStart.getTime()) {
    return { ok: false, error: "from must be on or before to" };
  }
  const dayCount = Math.round((toStart.getTime() - fromStart.getTime()) / DAY_MS) + 1;
  if (dayCount > MAX_REPORT_DAYS) {
    return { ok: false, error: `Range is limited to ${MAX_REPORT_DAYS} days` };
  }
  const days = [];
  for (let i = 0; i < dayCount; i += 1) {
    days.push(campusDateOf(new Date(fromStart.getTime() + i * DAY_MS)));
  }
  return {
    ok: true,
    fromDate: days[0],
    toDate: days[days.length - 1],
    start: fromStart,
    end: new Date(toStart.getTime() + DAY_MS),
    days,
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/** No-show share of finished calls (served + no-show), as a 0–1 fraction, or null. */
export function noShowRate(served, noShows) {
  const total = served + noShows;
  if (!total) return null;
  return Math.round((noShows / total) * 1000) / 1000;
}

/** Nearest-rank percentile of a numeric list (p in 0–100), or null when empty. */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

/**
 * Which queues this console user may report on, honouring venue / queue filters.
 * @returns {Promise<{ ok: true, queues: any[], venue: object | null } | { ok: false, status: number, error: string }>}
 */
async function resolveScope(user, query) {
  const venueParam = query.venueId != null && String(query.venueId).trim() !== "" ? String(query.venueId).trim() : null;
  const queueParam = query.queueId != null && String(query.queueId).trim() !== "" ? String(query.queueId).trim() : null;

  const scoped = await resolveVenueFilter(user, venueParam);
  if (!scoped.ok) return scoped;
  const venueFilter = scoped.filter;
  const venueJson = scoped.venue ? scoped.venue.toPublicJSON() : null;

  if (queueParam) {
    if (!mongoose.isValidObjectId(queueParam)) return { ok: false, status: 404, error: "Queue not found" };
    const queue = await Queue.findById(queueParam).populate("venue");
    if (!queue) return { ok: false, status: 404, error: "Queue not found" };
    if (scoped.venue && String(queue.venue?._id ?? queue.venue) !== String(scoped.venue._id)) {
      return { ok: false, status: 403, error: isStaff(user) ? VENUE_FORBIDDEN : "Queue is not in this venue" };
    }
    if (!canAccessQueue(user, queue)) {
      return { ok: false, status: 403, error: isStaff(user) ? QUEUE_FORBIDDEN : VENUE_FORBIDDEN };
    }
    return { ok: true, queues: [queue], venue: venueJson };
  }

  let queues = await Queue.find({ ...venueFilter, archivedAt: null }).populate("venue").sort({ name: 1 });
  const allowed = staffQueueIds(user);
  if (allowed) queues = queues.filter((q) => allowed.includes(String(q._id)));
  return { ok: true, queues, venue: venueJson };
}

/**
 * Build the analytics report for a console user.
 * @returns {Promise<{ ok: true, payload: object } | { ok: false, status: number, error: string }>}
 */
export async function buildAnalyticsReport(user, query = {}, at = clockNow()) {
  const range = resolveReportRange(query, at);
  if (!range.ok) return { ok: false, status: 400, error: range.error };
  const scope = await resolveScope(user, query);
  if (!scope.ok) return scope;

  const queueIds = scope.queues.map((q) => q._id);
  const rows = queueIds.length
    ? await QueueEntry.aggregate([
        {
          $match: {
            queue: { $in: queueIds },
            status: { $in: ["served", "skipped", "left"] },
            // updatedAt is never earlier than the terminal event time.
            updatedAt: { $gte: range.start },
          },
        },
        {
          $addFields: {
            eventAt: {
              $switch: {
                branches: [
                  { case: { $eq: ["$status", "served"] }, then: { $ifNull: ["$servedAt", "$updatedAt"] } },
                  { case: { $eq: ["$status", "skipped"] }, then: { $ifNull: ["$skippedAt", "$updatedAt"] } },
                ],
                default: "$updatedAt",
              },
            },
          },
        },
        { $match: { eventAt: { $gte: range.start, $lt: range.end } } },
        {
          $project: {
            queue: 1,
            status: 1,
            eventAt: 1,
            skipReason: 1,
            waitMs: {
              $cond: [
                { $eq: ["$status", "served"] },
                { $subtract: [{ $ifNull: ["$calledAt", "$eventAt"] }, "$createdAt"] },
                null,
              ],
            },
          },
        },
      ])
    : [];

  const daily = new Map(range.days.map((d) => [d, { date: d, served: 0, noShows: 0, timedOut: 0, left: 0, waitSum: 0 }]));
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, served: 0 }));
  const perQueue = new Map(
    scope.queues.map((q) => [String(q._id), { served: 0, noShows: 0, timedOut: 0, left: 0, waits: [] }])
  );
  const allWaits = [];

  for (const row of rows) {
    const at2 = new Date(row.eventAt);
    const day = daily.get(campusDateOf(at2));
    const q = perQueue.get(String(row.queue));
    if (!day || !q) continue;
    if (row.status === "served") {
      const waitMin = Math.max(0, (row.waitMs || 0) / 60000);
      day.served += 1;
      day.waitSum += waitMin;
      q.served += 1;
      q.waits.push(waitMin);
      allWaits.push(waitMin);
      const hour = new Date(at2.getTime() + CAMPUS_OFFSET_MS).getUTCHours();
      hourly[hour].served += 1;
    } else if (row.status === "skipped") {
      day.noShows += 1;
      q.noShows += 1;
      if (row.skipReason === "no-show") {
        day.timedOut += 1;
        q.timedOut += 1;
      }
    } else {
      day.left += 1;
      q.left += 1;
    }
  }

  const served = allWaits.length;
  const noShows = [...perQueue.values()].reduce((s, q) => s + q.noShows, 0);
  const left = [...perQueue.values()].reduce((s, q) => s + q.left, 0);
  const timedOut = [...perQueue.values()].reduce((s, q) => s + q.timedOut, 0);
  const frequentNoShows = await listFrequentNoShows(queueIds, at);
  const waitSum = allWaits.reduce((s, w) => s + w, 0);
  const peak = hourly.reduce((best, h) => (h.served > best.served ? h : best), { hour: null, served: 0 });
  const busiestDay = [...daily.values()].reduce((best, d) => (d.served > best.served ? d : best), { date: null, served: 0 });

  const ratings = await feedbackSummary(queueIds, range);
  const queueNames = new Map(scope.queues.map((q) => [String(q._id), q.name]));

  const queueRows = scope.queues.map((queue) => {
    const s = perQueue.get(String(queue._id));
    const r = ratings.byQueue.get(String(queue._id));
    const qWait = s.waits.reduce((a, b) => a + b, 0);
    return {
      id: String(queue._id),
      name: queue.name,
      venue: queue.venue?.name ?? null,
      served: s.served,
      noShows: s.noShows,
      timedOutNoShows: s.timedOut,
      left: s.left,
      noShowRate: noShowRate(s.served, s.noShows),
      averageWaitMinutes: s.served ? round1(qWait / s.served) : null,
      p90WaitMinutes: s.served ? round1(percentile(s.waits, 90)) : null,
      ratings: r?.ratings ?? 0,
      averageRating: r?.averageRating ?? null,
    };
  });

  return {
    ok: true,
    payload: {
      generatedAt: at.toISOString(),
      timeZone: "Asia/Kolkata",
      range: { from: range.fromDate, to: range.toDate, days: range.days.length },
      venue: scope.venue,
      queueId: query.queueId ? String(query.queueId) : null,
      totals: {
        served,
        noShows,
        timedOutNoShows: timedOut,
        left,
        noShowRate: noShowRate(served, noShows),
        averageWaitMinutes: served ? round1(waitSum / served) : null,
        p90WaitMinutes: served ? round1(percentile(allWaits, 90)) : null,
        averageServedPerDay: round1(served / range.days.length),
        peakHour: peak.served ? peak.hour : null,
        busiestDay: busiestDay.served ? { date: busiestDay.date, served: busiestDay.served } : null,
        ratings: ratings.totals.ratings,
        averageRating: ratings.totals.averageRating,
      },
      daily: [...daily.values()].map((d) => ({
        date: d.date,
        served: d.served,
        noShows: d.noShows,
        timedOutNoShows: d.timedOut,
        left: d.left,
        averageWaitMinutes: d.served ? round1(d.waitSum / d.served) : null,
      })),
      hourly,
      queues: queueRows,
      counters: ratings.counters
        .map((row) => ({ ...row, queue: queueNames.get(row.queueId) || null }))
        .sort((a, b) => (a.queue || "").localeCompare(b.queue || "") || a.counter.localeCompare(b.counter)),
      noShowPolicy: { threshold: FREQUENT_NO_SHOW_THRESHOLD, windowDays: NO_SHOW_WINDOW_DAYS },
      frequentNoShows,
      comments: ratings.comments.map((row) => ({ ...row, queue: queueNames.get(row.queueId) || null })),
    },
  };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  // Neutralise spreadsheet formula injection from queue / venue names.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function pct(rate) {
  return rate == null ? "" : (rate * 100).toFixed(1);
}

/** Report payload → CSV with a leading `section` column (summary, daily, hourly, queue). */
export function formatAnalyticsReportCsv(payload) {
  const header = [
    "section",
    "label",
    "venue",
    "served",
    "no_shows",
    "left",
    "no_show_rate_pct",
    "avg_wait_min",
    "p90_wait_min",
    "ratings",
    "avg_rating",
  ];
  const lines = [header.join(",")];
  const push = (cells) => lines.push(cells.map(csvCell).join(","));
  const t = payload.totals;
  push([
    "summary",
    `${payload.range.from} to ${payload.range.to}`,
    payload.venue?.name || "All venues",
    t.served,
    t.noShows,
    t.left,
    pct(t.noShowRate),
    t.averageWaitMinutes ?? "",
    t.p90WaitMinutes ?? "",
    t.ratings ?? 0,
    t.averageRating ?? "",
  ]);
  for (const d of payload.daily) {
    push(["daily", d.date, "", d.served, d.noShows, d.left, pct(noShowRate(d.served, d.noShows)), d.averageWaitMinutes ?? "", "", "", ""]);
  }
  for (const h of payload.hourly) {
    push(["hourly", `${String(h.hour).padStart(2, "0")}:00 IST`, "", h.served, "", "", "", "", "", "", ""]);
  }
  for (const q of payload.queues) {
    push([
      "queue",
      q.name,
      q.venue || "",
      q.served,
      q.noShows,
      q.left,
      pct(q.noShowRate),
      q.averageWaitMinutes ?? "",
      q.p90WaitMinutes ?? "",
      q.ratings ?? 0,
      q.averageRating ?? "",
    ]);
  }
  for (const c of payload.counters || []) {
    push(["counter", `${c.queue || ""} · ${c.counter}`, "", "", "", "", "", "", "", c.ratings, c.averageRating ?? ""]);
  }
  return `${lines.join("\n")}\n`;
}
