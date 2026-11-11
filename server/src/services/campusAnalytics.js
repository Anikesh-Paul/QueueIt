/**
 * Campus (or venue-scoped) analytics rollup and CSV export.
 */
import mongoose from "mongoose";
import { Queue } from "../models/Queue.js";
import { Venue } from "../models/Venue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import { dateRangeMatch, resolveAnalyticsRange } from "./analyticsRange.js";
import { isGlobalAdmin, isStaff, staffQueueIds, staffVenueId, VENUE_FORBIDDEN } from "./staffAccess.js";

function roundWaitMinutes(value) {
  return Math.round(value * 10) / 10;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * @param {import("mongoose").Document} user
 * @param {{ window?: string, from?: string, to?: string, venueId?: string }} query
 */
export async function collectCampusAnalytics(user, query = {}) {
  const range = resolveAnalyticsRange(query);
  if (!range.ok) return { ok: false, status: 400, error: range.error };

  let venueFilter = {};
  let venueJson = null;
  const requested = query.venueId != null && String(query.venueId).trim() !== ""
    ? String(query.venueId).trim()
    : null;

  if (isStaff(user)) {
    const assigned = staffVenueId(user);
    if (!assigned) return { ok: false, status: 403, error: VENUE_FORBIDDEN };
    if (requested && requested !== assigned) {
      return { ok: false, status: 403, error: VENUE_FORBIDDEN };
    }
    const venue = await Venue.findById(assigned);
    if (!venue) return { ok: false, status: 403, error: VENUE_FORBIDDEN };
    venueFilter = { venue: venue._id };
    venueJson = venue.toPublicJSON();
  } else if (!isGlobalAdmin(user)) {
    return { ok: false, status: 403, error: VENUE_FORBIDDEN };
  } else if (requested) {
    if (!mongoose.isValidObjectId(requested)) {
      return { ok: false, status: 404, error: "Venue not found" };
    }
    const venue = await Venue.findById(requested);
    if (!venue) return { ok: false, status: 404, error: "Venue not found" };
    venueFilter = { venue: venue._id };
    venueJson = venue.toPublicJSON();
  }

  let queues = await Queue.find({ ...venueFilter, archivedAt: null })
    .populate("venue")
    .sort({ name: 1 })
    .exec();
  const allowedQueues = staffQueueIds(user);
  if (allowedQueues) {
    queues = queues.filter((queue) => allowedQueues.includes(String(queue._id)));
  }
  const queueIds = queues.map((queue) => queue._id);
  const terminalMatch = dateRangeMatch("updatedAt", range);

  const emptyMetrics = {
    servedCount: 0,
    skippedCount: 0,
    leftCount: 0,
    waitingCount: 0,
    averageWaitMinutes: null,
    longestWaitMinutes: null,
  };

  if (queueIds.length === 0) {
    return {
      ok: true,
      payload: {
        venue: venueJson,
        range: {
          preset: range.preset,
          from: range.from ? range.from.toISOString() : null,
          to: range.to ? range.to.toISOString() : null,
        },
        metrics: emptyMetrics,
        peakHours: [],
        queues: [],
      },
    };
  }

  const [servedCount, skippedCount, leftCount, waitingRows, [facet], perQueue] = await Promise.all([
    QueueEntry.countDocuments({ queue: { $in: queueIds }, status: "served", ...terminalMatch }),
    QueueEntry.countDocuments({ queue: { $in: queueIds }, status: "skipped", ...terminalMatch }),
    QueueEntry.countDocuments({ queue: { $in: queueIds }, status: "left", ...terminalMatch }),
    QueueEntry.aggregate([
      { $match: { queue: { $in: queueIds }, status: "waiting" } },
      { $group: { _id: "$queue", count: { $sum: 1 } } },
    ]),
    QueueEntry.aggregate([
      { $match: { queue: { $in: queueIds }, status: "served", ...terminalMatch } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                waitMinutesSum: {
                  $sum: { $divide: [{ $subtract: ["$updatedAt", "$createdAt"] }, 60000] },
                },
                maxWaitMinutes: {
                  $max: { $divide: [{ $subtract: ["$updatedAt", "$createdAt"] }, 60000] },
                },
              },
            },
          ],
          peakHours: [
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%H:00 IST",
                    date: "$updatedAt",
                    timezone: "Asia/Kolkata",
                  },
                },
                served: { $sum: 1 },
              },
            },
            { $sort: { served: -1, _id: 1 } },
            { $limit: 3 },
          ],
        },
      },
    ]),
    QueueEntry.aggregate([
      { $match: { queue: { $in: queueIds }, status: { $in: ["served", "skipped", "left"] }, ...terminalMatch } },
      {
        $group: {
          _id: { queue: "$queue", status: "$status" },
          count: { $sum: 1 },
          waitMinutesSum: {
            $sum: {
              $cond: [
                { $eq: ["$status", "served"] },
                { $divide: [{ $subtract: ["$updatedAt", "$createdAt"] }, 60000] },
                0,
              ],
            },
          },
          maxWaitMinutes: {
            $max: {
              $cond: [
                { $eq: ["$status", "served"] },
                { $divide: [{ $subtract: ["$updatedAt", "$createdAt"] }, 60000] },
                null,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const waitingByQueue = new Map(waitingRows.map((row) => [String(row._id), row.count]));
  const waitingCount = waitingRows.reduce((sum, row) => sum + row.count, 0);
  const totals = facet?.totals?.[0] || { count: 0, waitMinutesSum: 0, maxWaitMinutes: 0 };
  const hasServed = totals.count > 0;

  const byQueue = new Map();
  for (const row of perQueue) {
    const id = String(row._id.queue);
    const current = byQueue.get(id) || { servedCount: 0, skippedCount: 0, leftCount: 0, waitMinutesSum: 0, maxWaitMinutes: 0 };
    if (row._id.status === "served") {
      current.servedCount = row.count;
      current.waitMinutesSum = row.waitMinutesSum;
      current.maxWaitMinutes = row.maxWaitMinutes || 0;
    } else if (row._id.status === "skipped") {
      current.skippedCount = row.count;
    } else if (row._id.status === "left") {
      current.leftCount = row.count;
    }
    byQueue.set(id, current);
  }

  const queueRows = queues.map((queue) => {
    const stats = byQueue.get(String(queue._id)) || {
      servedCount: 0,
      skippedCount: 0,
      leftCount: 0,
      waitMinutesSum: 0,
      maxWaitMinutes: 0,
    };
    const served = stats.servedCount;
    return {
      id: queue._id.toString(),
      name: queue.name,
      venue: queue.venue?.name || queue.venue?.toPublicJSON?.().name || null,
      servedCount: stats.servedCount,
      skippedCount: stats.skippedCount,
      leftCount: stats.leftCount,
      waitingCount: waitingByQueue.get(String(queue._id)) || 0,
      averageWaitMinutes: served ? roundWaitMinutes(stats.waitMinutesSum / served) : null,
      longestWaitMinutes: served ? roundWaitMinutes(stats.maxWaitMinutes) : null,
    };
  });

  return {
    ok: true,
    payload: {
      venue: venueJson,
      range: {
        preset: range.preset,
        from: range.from ? range.from.toISOString() : null,
        to: range.to ? range.to.toISOString() : null,
      },
      metrics: {
        servedCount,
        skippedCount,
        leftCount,
        waitingCount,
        averageWaitMinutes: hasServed ? roundWaitMinutes(totals.waitMinutesSum / totals.count) : null,
        longestWaitMinutes: hasServed ? roundWaitMinutes(totals.maxWaitMinutes) : null,
      },
      peakHours: (facet?.peakHours || []).map((hour) => ({
        label: hour._id,
        served: hour.served,
      })),
      queues: queueRows,
    },
  };
}

/**
 * @param {{ payload: object }} result
 */
export function formatCampusAnalyticsCsv(payload) {
  const headers = [
    "queue",
    "venue",
    "served",
    "skipped",
    "left",
    "waiting_now",
    "average_wait_minutes",
    "longest_wait_minutes",
    "window",
    "from",
    "to",
  ];
  const windowLabel = payload.range?.preset || "all";
  const from = payload.range?.from || "";
  const to = payload.range?.to || "";
  const lines = [headers.join(",")];
  for (const row of payload.queues || []) {
    lines.push(
      [
        csvEscape(row.name),
        csvEscape(row.venue),
        row.servedCount,
        row.skippedCount,
        row.leftCount,
        row.waitingCount,
        row.averageWaitMinutes ?? "",
        row.longestWaitMinutes ?? "",
        windowLabel,
        from,
        to,
      ].join(",")
    );
  }
  const totals = payload.metrics || {};
  lines.push(
    [
      "Totals",
      payload.venue?.name || "All venues",
      totals.servedCount ?? 0,
      totals.skippedCount ?? 0,
      totals.leftCount ?? 0,
      totals.waitingCount ?? 0,
      totals.averageWaitMinutes ?? "",
      totals.longestWaitMinutes ?? "",
      windowLabel,
      from,
      to,
    ].join(",")
  );
  return `${lines.join("\n")}\n`;
}
