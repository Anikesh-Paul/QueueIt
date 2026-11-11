import { Venue } from "../models/Venue.js";
import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import { normalizeServiceWindows, validateServiceWindows } from "./serviceWindows.js";
import {
  COUNTER_NAME_MAX,
  DEFAULT_COUNTER_NAME,
  ensureDefaultCounters,
  findCounter,
  normalizeCounterName,
} from "./counters.js";

export const NAME_MAX = 80;
export const SERVICE_TIME_MIN = 1;
export const SERVICE_TIME_MAX = 60;

export function slugifyName(name) {
  const slug = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "queue";
}

function cleanName(raw, label = "Name") {
  if (typeof raw !== "string") {
    return { error: `${label} is required` };
  }
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { error: `${label} is required` };
  if (name.length > NAME_MAX) return { error: `${label} must be ${NAME_MAX} characters or fewer` };
  return { name };
}

function cleanServiceTime(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < SERVICE_TIME_MIN || value > SERVICE_TIME_MAX) {
    return { error: `Average service time must be an integer from ${SERVICE_TIME_MIN} to ${SERVICE_TIME_MAX}` };
  }
  return { value };
}

async function uniqueVenueSlug(base, excludeId) {
  let slug = base;
  let n = 2;
  for (;;) {
    const existing = await Venue.findOne({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    if (!existing) return slug;
    slug = `${base}-${n++}`;
  }
}

async function uniqueQueueSlug(venueId, base, excludeId) {
  let slug = base;
  let n = 2;
  for (;;) {
    const filter = { venue: venueId, slug };
    if (excludeId) filter._id = { $ne: excludeId };
    const existing = await Queue.findOne(filter);
    if (!existing) return slug;
    slug = `${base}-${n++}`;
  }
}

export function toAdminVenueJSON(venue, queues = []) {
  return {
    id: venue._id.toString(),
    name: venue.name,
    slug: venue.slug,
    queues: queues.map((queue) => toAdminCatalogQueueJSON(queue, venue)),
  };
}

export function toAdminCatalogQueueJSON(queue, venue) {
  ensureDefaultCounters(queue);
  return {
    ...queue.toPublicJSON(),
    slug: queue.slug,
    archived: Boolean(queue.archivedAt),
    archivedAt: queue.archivedAt ? new Date(queue.archivedAt).toISOString() : null,
    venue: venue
      ? venue.toPublicJSON?.() || { id: venue._id.toString(), name: venue.name }
      : queue.toPublicJSON().venue,
  };
}

export async function listAdminCatalog() {
  const venues = await Venue.find({}).sort({ name: 1 }).exec();
  const queues = await Queue.find({}).sort({ name: 1 }).exec();
  const byVenue = new Map();
  for (const queue of queues) {
    const key = queue.venue?.toString();
    if (!byVenue.has(key)) byVenue.set(key, []);
    byVenue.get(key).push(queue);
  }
  return venues.map((venue) => toAdminVenueJSON(venue, byVenue.get(venue._id.toString()) || []));
}

export async function createVenue({ name }) {
  const cleaned = cleanName(name, "Venue name");
  if (cleaned.error) return { ok: false, status: 400, error: cleaned.error };
  const slug = await uniqueVenueSlug(slugifyName(cleaned.name));
  const venue = await Venue.create({ name: cleaned.name, slug });
  return { ok: true, venue };
}

export async function updateVenue(venue, { name }) {
  if (name !== undefined) {
    const cleaned = cleanName(name, "Venue name");
    if (cleaned.error) return { ok: false, status: 400, error: cleaned.error };
    venue.name = cleaned.name;
  }
  await venue.save();
  return { ok: true, venue };
}

export async function createQueue({ venueId, name, averageServiceTime, serviceWindows, counters }) {
  if (!venueId) return { ok: false, status: 400, error: "Venue is required" };
  const venue = await Venue.findById(venueId);
  if (!venue) return { ok: false, status: 404, error: "Venue not found" };

  const cleaned = cleanName(name, "Queue name");
  if (cleaned.error) return { ok: false, status: 400, error: cleaned.error };
  const pace = cleanServiceTime(averageServiceTime ?? 3);
  if (pace.error) return { ok: false, status: 400, error: pace.error };

  let windows = [];
  if (serviceWindows !== undefined) {
    const check = validateServiceWindows(serviceWindows);
    if (!check.ok) return { ok: false, status: 400, error: check.error };
    windows = normalizeServiceWindows(serviceWindows);
  }

  let counterDocs = [{ name: DEFAULT_COUNTER_NAME, nowServing: null }];
  if (Array.isArray(counters) && counters.length > 0) {
    const names = counters
      .map((row) => normalizeCounterName(row?.name || "", ""))
      .filter(Boolean);
    if (names.length === 0) {
      return { ok: false, status: 400, error: "Each counter needs a name" };
    }
    counterDocs = names.map((counterName) => ({ name: counterName, nowServing: null }));
  }

  const slug = await uniqueQueueSlug(venue._id, slugifyName(cleaned.name));
  const queue = await Queue.create({
    name: cleaned.name,
    slug,
    venue: venue._id,
    averageServiceTime: pace.value,
    serviceWindows: windows,
    status: "open",
    acceptingTokens: true,
    counters: counterDocs,
  });
  return { ok: true, queue, venue };
}

export async function updateQueue(queue, patch = {}) {
  if (patch.name !== undefined) {
    const cleaned = cleanName(patch.name, "Queue name");
    if (cleaned.error) return { ok: false, status: 400, error: cleaned.error };
    queue.name = cleaned.name;
  }
  if (patch.averageServiceTime !== undefined) {
    const pace = cleanServiceTime(patch.averageServiceTime);
    if (pace.error) return { ok: false, status: 400, error: pace.error };
    queue.averageServiceTime = pace.value;
  }
  if (patch.serviceWindows !== undefined) {
    const check = validateServiceWindows(patch.serviceWindows);
    if (!check.ok) return { ok: false, status: 400, error: check.error };
    queue.serviceWindows = normalizeServiceWindows(patch.serviceWindows);
  }
  if (patch.archived === true && !queue.archivedAt) {
    queue.archivedAt = new Date();
  }
  if (patch.archived === false) {
    queue.archivedAt = null;
  }
  await queue.save();
  return { ok: true, queue };
}

export async function addCounter(queue, { name }) {
  ensureDefaultCounters(queue);
  const cleaned = normalizeCounterName(name, "");
  if (!cleaned) {
    return { ok: false, status: 400, error: `Counter name must be 1–${COUNTER_NAME_MAX} characters` };
  }
  queue.counters.push({ name: cleaned, nowServing: null });
  await queue.save();
  return { ok: true, queue, counter: queue.counters[queue.counters.length - 1] };
}

export async function renameCounter(queue, counterId, { name }) {
  ensureDefaultCounters(queue);
  const counter = findCounter(queue, counterId);
  if (!counter) return { ok: false, status: 404, error: "Counter not found" };
  const cleaned = normalizeCounterName(name, "");
  if (!cleaned) {
    return { ok: false, status: 400, error: `Counter name must be 1–${COUNTER_NAME_MAX} characters` };
  }
  counter.name = cleaned;
  await queue.save();
  return { ok: true, queue, counter };
}

export async function removeCounter(queue, counterId) {
  ensureDefaultCounters(queue);
  if (queue.counters.length <= 1) {
    return { ok: false, status: 409, error: "A queue needs at least one counter" };
  }
  const counter = findCounter(queue, counterId);
  if (!counter) return { ok: false, status: 404, error: "Counter not found" };
  const busy = await QueueEntry.exists({
    queue: queue._id,
    status: "serving",
    servingCounterId: counter._id,
  });
  if (busy) {
    return { ok: false, status: 409, error: "Serve or skip the person at this counter first" };
  }
  queue.counters.pull(counter._id);
  await queue.save();
  return { ok: true, queue };
}

export function isArchived(queue) {
  return Boolean(queue?.archivedAt);
}
