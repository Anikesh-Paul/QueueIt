/**
 * Announcement board: short notices staff post to the campus, a venue or a queue.
 * Students read the ones that apply; staff can only post where they have access.
 */
import mongoose from "mongoose";
import {
  Announcement,
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TONES,
} from "../models/Announcement.js";
import { Queue } from "../models/Queue.js";
import { Venue } from "../models/Venue.js";
import { now as clockNow } from "./clock.js";
import { campusLocalToUtc, getCampusParts } from "./serviceWindows.js";
import { canAccessQueue, canAccessVenue, isGlobalAdmin, staffVenueId } from "./staffAccess.js";

export const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_PUBLIC = 30;

export class AnnouncementError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 23:59 IST on the campus day of `at`. */
export function endOfCampusDay(at) {
  const p = getCampusParts(at);
  return campusLocalToUtc(p.year, p.month, p.day, 23, 59, 0);
}

function parseDate(raw, label) {
  if (raw == null || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new AnnouncementError(400, `${label} isn't a valid time`);
  return d;
}

/** Validate text, tone and the time window. Returns clean fields. */
export function cleanAnnouncementFields(input = {}, { existing = null, at = clockNow() } = {}) {
  const out = {};
  if (input.title !== undefined || !existing) {
    const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
    if (!title) throw new AnnouncementError(400, "Add a title");
    if (title.length > ANNOUNCEMENT_TITLE_MAX) {
      throw new AnnouncementError(400, `Keep the title under ${ANNOUNCEMENT_TITLE_MAX} characters`);
    }
    out.title = title;
  }
  if (input.body !== undefined) {
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (body.length > ANNOUNCEMENT_BODY_MAX) {
      throw new AnnouncementError(400, `Keep the details under ${ANNOUNCEMENT_BODY_MAX} characters`);
    }
    out.body = body;
  }
  if (input.tone !== undefined || !existing) {
    const tone = input.tone ?? "info";
    if (!ANNOUNCEMENT_TONES.includes(tone)) throw new AnnouncementError(400, "Pick Info, Delay or Closure");
    out.tone = tone;
  }

  const startsAt = parseDate(input.startsAt, "Start") ?? existing?.startsAt ?? at;
  let endsAt = parseDate(input.endsAt, "End");
  if (!endsAt) endsAt = existing?.endsAt ?? endOfCampusDay(startsAt > at ? startsAt : at);
  if (endsAt <= startsAt) throw new AnnouncementError(400, "The end has to be after the start");
  if (endsAt <= at) throw new AnnouncementError(400, "The end time has already passed");
  if (endsAt.getTime() - startsAt.getTime() > MAX_DURATION_MS) {
    throw new AnnouncementError(400, "A notice can run for at most 7 days");
  }
  if (input.startsAt !== undefined || !existing) out.startsAt = startsAt;
  if (input.endsAt !== undefined || !existing) out.endsAt = endsAt;
  return out;
}

/** Resolve scope + target and check the poster may use it. */
export async function resolveTarget(user, input = {}) {
  const scope = input.scope;
  if (scope === "campus") {
    if (!isGlobalAdmin(user)) throw new AnnouncementError(403, "Only campus admins can post to everyone");
    return { scope, venue: null, queue: null, venueDoc: null, queueDoc: null };
  }
  if (scope === "venue") {
    const venueId = input.venueId ?? staffVenueId(user);
    if (!venueId || !mongoose.isValidObjectId(venueId)) throw new AnnouncementError(400, "Pick a venue");
    const venueDoc = await Venue.findById(venueId);
    if (!venueDoc) throw new AnnouncementError(404, "Venue not found");
    if (!canAccessVenue(user, venueDoc._id)) throw new AnnouncementError(403, "You don't have access to this venue");
    return { scope, venue: venueDoc._id, queue: null, venueDoc, queueDoc: null };
  }
  if (scope === "queue") {
    if (!input.queueId || !mongoose.isValidObjectId(input.queueId)) throw new AnnouncementError(400, "Pick a queue");
    const queueDoc = await Queue.findById(input.queueId).populate("venue", "name");
    if (!queueDoc) throw new AnnouncementError(404, "Queue not found");
    if (!canAccessQueue(user, queueDoc)) throw new AnnouncementError(403, "You don't have access to this queue");
    return { scope, venue: queueDoc.venue?._id ?? queueDoc.venue, queue: queueDoc._id, venueDoc: queueDoc.venue, queueDoc };
  }
  throw new AnnouncementError(400, "Pick who should see this");
}

/** Whether a console user may edit or end this notice. */
export function canManageAnnouncement(user, doc) {
  if (isGlobalAdmin(user)) return true;
  if (doc.scope === "campus") return false;
  if (doc.scope === "venue") return canAccessVenue(user, doc.venue);
  return canAccessQueue(user, { _id: doc.queue, venue: doc.venue });
}

export function announcementState(doc, at = clockNow()) {
  if (doc.endedEarlyAt || doc.endsAt <= at) return "ended";
  if (doc.startsAt > at) return "scheduled";
  return "live";
}

export function toAnnouncementJSON(doc, { at = clockNow(), names = null } = {}) {
  const venueId = doc.venue ? String(doc.venue._id ?? doc.venue) : null;
  const queueId = doc.queue ? String(doc.queue._id ?? doc.queue) : null;
  const json = {
    id: String(doc._id),
    scope: doc.scope,
    venueId,
    queueId,
    tone: doc.tone,
    title: doc.title,
    body: doc.body || "",
    startsAt: doc.startsAt.toISOString(),
    endsAt: (doc.endedEarlyAt || doc.endsAt).toISOString(),
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  };
  if (names) {
    json.state = announcementState(doc, at);
    json.author = doc.author?.name || null;
    json.venueName = venueId ? names.venues.get(venueId) ?? null : null;
    json.queueName = queueId ? names.queues.get(queueId) ?? null : null;
  }
  return json;
}

/** Notices live right now, for everyone. Clients filter by venue and queue. */
export async function listLiveAnnouncements({ queueId = null, at = clockNow() } = {}) {
  const filter = { startsAt: { $lte: at }, endsAt: { $gt: at }, endedEarlyAt: null };
  if (queueId) {
    const queue = await Queue.findById(queueId).select("venue");
    if (!queue) return [];
    filter.$or = [{ scope: "campus" }, { scope: "venue", venue: queue.venue }, { scope: "queue", queue: queue._id }];
  }
  const docs = await Announcement.find(filter).sort({ startsAt: -1, _id: -1 }).limit(MAX_ACTIVE_PUBLIC);
  return docs.map((d) => toAnnouncementJSON(d, { at }));
}

async function nameMaps(docs) {
  const venueIds = [...new Set(docs.map((d) => d.venue && String(d.venue)).filter(Boolean))];
  const queueIds = [...new Set(docs.map((d) => d.queue && String(d.queue)).filter(Boolean))];
  const [venues, queues] = await Promise.all([
    venueIds.length ? Venue.find({ _id: { $in: venueIds } }).select("name") : [],
    queueIds.length ? Queue.find({ _id: { $in: queueIds } }).select("name") : [],
  ]);
  return {
    venues: new Map(venues.map((v) => [String(v._id), v.name])),
    queues: new Map(queues.map((q) => [String(q._id), q.name])),
  };
}

/** Console list: live and scheduled first, then the last 7 days of ended ones. */
export async function listAnnouncementsForConsole(user, at = clockNow()) {
  const since = new Date(at.getTime() - 7 * 24 * 60 * 60 * 1000);
  const docs = await Announcement.find({ endsAt: { $gt: since } }).sort({ startsAt: -1, _id: -1 }).limit(200);
  const mine = docs.filter((d) => d.scope === "campus" || canManageAnnouncement(user, d));
  const names = await nameMaps(mine);
  const rows = mine.map((d) => ({ ...toAnnouncementJSON(d, { at, names }), canManage: canManageAnnouncement(user, d) }));
  const rank = { live: 0, scheduled: 1, ended: 2 };
  rows.sort((a, b) => rank[a.state] - rank[b.state]);
  return rows;
}

export async function createAnnouncement(user, input, at = clockNow()) {
  const target = await resolveTarget(user, input);
  const fields = cleanAnnouncementFields(input, { at });
  const doc = await Announcement.create({
    scope: target.scope,
    venue: target.venue,
    queue: target.queue,
    ...fields,
    author: { id: String(user._id), name: user.name || user.email || null },
  });
  return { doc, target };
}

export async function updateAnnouncement(user, id, input, at = clockNow()) {
  const doc = mongoose.isValidObjectId(id) ? await Announcement.findById(id) : null;
  if (!doc) throw new AnnouncementError(404, "Notice not found");
  if (!canManageAnnouncement(user, doc)) throw new AnnouncementError(403, "You can't change this notice");
  if (announcementState(doc, at) === "ended") throw new AnnouncementError(409, "This notice has ended");
  const fields = cleanAnnouncementFields(input, { existing: doc, at });
  const changed = Object.keys(fields).filter((k) => String(doc[k]) !== String(fields[k]));
  Object.assign(doc, fields);
  await doc.save();
  return { doc, changed };
}

export async function endAnnouncement(user, id, at = clockNow()) {
  const doc = mongoose.isValidObjectId(id) ? await Announcement.findById(id) : null;
  if (!doc) throw new AnnouncementError(404, "Notice not found");
  if (!canManageAnnouncement(user, doc)) throw new AnnouncementError(403, "You can't change this notice");
  if (announcementState(doc, at) !== "ended") {
    doc.endedEarlyAt = at;
    await doc.save();
  }
  return doc;
}
