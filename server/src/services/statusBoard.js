/**
 * Public campus wait board. Read-only: never closes sessions, never expires
 * no-shows, never reconciles counters, never calls save.
 *
 * Cached in memory (and Cache-Control for a CDN) so a widely shared link
 * cannot stampede the database. Numbers may lag by STATUS_BOARD_TTL_SECONDS.
 */
import mongoose from "mongoose";
import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import { Venue } from "../models/Venue.js";
import { Organization } from "../models/Organization.js";
import { now as clockNow } from "./clock.js";
import { attachWaitEstimates } from "./smartEstimate.js";
import { staffingFactor, counterState, DEFAULT_COUNTER_NAME } from "./counters.js";
import { partySizeOf } from "./partySize.js";
import { defaultOrgJSON, findOrganization, orgIdOfVenue, venueIdsForOrg } from "./organizations.js";

export const STATUS_BOARD_TTL_SECONDS = 20;
export const STATUS_BOARD_REFRESH_SECONDS = 15;
export const STATUS_BOARD_CACHE_HEADER = `public, max-age=${STATUS_BOARD_TTL_SECONDS}, s-maxage=${STATUS_BOARD_TTL_SECONDS}, stale-while-revalidate=${STATUS_BOARD_TTL_SECONDS * 2}`;

const CACHE_MAX = 200;
const cache = new Map();

function cacheGet(key, at) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (at.getTime() - hit.at > STATUS_BOARD_TTL_SECONDS * 1000 || at.getTime() < hit.at) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cachePut(key, value, at) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: at.getTime(), value });
}

export function clearStatusBoardCache() {
  cache.clear();
}

/** Accepting-tokens as of `at`, without persisting a session close. */
export function publicAcceptingTokens(queue, at = clockNow()) {
  if (queue?.acceptingTokens === false) return false;
  if (!queue?.sessionEndsAt) return true;
  const ends = queue.sessionEndsAt instanceof Date ? queue.sessionEndsAt : new Date(queue.sessionEndsAt);
  if (Number.isNaN(ends.getTime())) return true;
  return at.getTime() < ends.getTime();
}

async function findVenueByKey(key) {
  if (!key || typeof key !== "string") return null;
  const k = key.trim();
  if (!k) return null;
  if (mongoose.isValidObjectId(k)) return Venue.findById(k);
  return Venue.findOne({ slug: k.toLowerCase() });
}

function publicOrgOfVenue(venue, orgById) {
  const orgId = venue?.organization ? String(venue.organization._id ?? venue.organization) : null;
  if (!orgId) return defaultOrgJSON();
  const doc = orgById.get(orgId);
  if (!doc) return defaultOrgJSON();
  return { id: String(doc._id), slug: doc.slug, name: doc.name, isDefault: false };
}

function publicVenue(venue) {
  if (!venue) return null;
  return {
    id: String(venue._id || venue.id),
    name: venue.name || null,
    slug: venue.slug || null,
  };
}

function publicCounters(queue, servingRows) {
  const list = Array.isArray(queue?.counters) && queue.counters.length ? queue.counters : [{ name: DEFAULT_COUNTER_NAME, nowServing: null }];
  const unused = [...(servingRows || [])];
  const counters = list.map((counter) => {
    const id = counter._id ? String(counter._id) : null;
    let idx = id ? unused.findIndex((row) => row.servingCounterId && String(row.servingCounterId) === id) : -1;
    if (idx < 0) idx = unused.findIndex((row) => !row.servingCounterId);
    const match = idx >= 0 ? unused.splice(idx, 1)[0] : null;
    return {
      id,
      name: counter.name || DEFAULT_COUNTER_NAME,
      state: counterState(counter),
      nowServing: match && Number.isInteger(match.tokenNumber) ? match.tokenNumber : null,
      nowServingPartySize: match ? partySizeOf(match) : null,
    };
  });
  const open = counters.filter((c) => c.state === "open").length;
  return { counters, openCounters: open, totalCounters: counters.length };
}

/**
 * @param {{ orgKey?: string, venueKey?: string, at?: Date }} [opts]
 * @returns {Promise<{ ok: true, payload: object } | { ok: false, status: number, error: string }>}
 */
export async function collectStatusBoard({ orgKey = "", venueKey = "", at = clockNow() } = {}) {
  const orgQuery = typeof orgKey === "string" ? orgKey.trim() : "";
  const venueQuery = typeof venueKey === "string" ? venueKey.trim() : "";

  let org = null;
  if (orgQuery) {
    org = await findOrganization(orgQuery);
    if (!org) return { ok: false, status: 404, error: "Organization not found" };
  }

  let venue = null;
  if (venueQuery) {
    venue = await findVenueByKey(venueQuery);
    if (!venue) return { ok: false, status: 404, error: "Venue not found" };
    if (org && orgIdOfVenue(venue) !== org.id) {
      return { ok: false, status: 404, error: "Venue not found" };
    }
  }

  const cacheKey = `org:${org ? org.id : "*"}|venue:${venue ? String(venue._id) : "*"}`;
  const cached = cacheGet(cacheKey, at);
  if (cached) return { ok: true, payload: cached };

  const filter = { archivedAt: null, status: { $in: ["open", "paused"] } };
  if (venue) {
    filter.venue = venue._id;
  } else if (org) {
    filter.venue = { $in: await venueIdsForOrg(org) };
  }

  const queues = await Queue.find(filter).populate("venue").sort({ name: 1 }).lean();
  const queueIds = queues.map((q) => q._id);

  const orgIds = [
    ...new Set(
      queues
        .map((q) => q.venue?.organization)
        .filter(Boolean)
        .map((id) => String(id._id ?? id))
    ),
  ];
  const orgDocs = orgIds.length ? await Organization.find({ _id: { $in: orgIds } }).lean() : [];
  const orgById = new Map(orgDocs.map((doc) => [String(doc._id), doc]));

  const [waitingRows, servingRows, estimateRows] = await Promise.all([
    queueIds.length
      ? QueueEntry.aggregate([
          { $match: { queue: { $in: queueIds }, status: "waiting" } },
          { $group: { _id: "$queue", n: { $sum: 1 }, people: { $sum: { $ifNull: ["$partySize", 1] } } } },
        ])
      : [],
    queueIds.length
      ? QueueEntry.find({ queue: { $in: queueIds }, status: "serving" })
          .select("tokenNumber partySize servingCounterId queue")
          .lean()
      : [],
    attachWaitEstimates(
      queues.map((q) => ({ id: String(q._id), full: false })),
      queues.map((q) => ({ ...q, acceptingTokens: publicAcceptingTokens(q, at) })),
      { at, staffing: staffingFactor }
    ),
  ]);

  const waitingBy = new Map(waitingRows.map((row) => [String(row._id), row]));
  const servingBy = new Map();
  for (const row of servingRows) {
    const id = String(row.queue);
    const list = servingBy.get(id);
    if (list) list.push(row);
    else servingBy.set(id, [row]);
  }
  const estimateBy = new Map(estimateRows.map((row) => [String(row.id), row.waitEstimate ?? null]));

  const payload = {
    generatedAt: at.toISOString(),
    cacheTtlSeconds: STATUS_BOARD_TTL_SECONDS,
    refreshSeconds: STATUS_BOARD_REFRESH_SECONDS,
    queues: queues.map((queue) => {
      const id = String(queue._id);
      const waiting = waitingBy.get(id);
      const { counters, openCounters, totalCounters } = publicCounters(queue, servingBy.get(id) || []);
      return {
        id,
        name: queue.name,
        slug: queue.slug || null,
        venue: publicVenue(queue.venue),
        organization: publicOrgOfVenue(queue.venue, orgById),
        status: queue.status === "paused" ? "paused" : "open",
        acceptingTokens: publicAcceptingTokens(queue, at),
        waitingCount: waiting?.n || 0,
        waitingPeople: waiting?.people || 0,
        waitEstimate: estimateBy.get(id) ?? null,
        counters,
        openCounters,
        totalCounters,
      };
    }),
  };

  cachePut(cacheKey, payload, at);
  return { ok: true, payload };
}
