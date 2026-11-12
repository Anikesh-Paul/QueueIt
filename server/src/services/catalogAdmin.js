import { applyAppointmentSettings } from "./appointments.js";
import { Venue } from "../models/Venue.js";
import { Queue } from "../models/Queue.js";
import { QueueEntry } from "../models/QueueEntry.js";
import { normalizeServiceWindows, validateServiceWindows } from "./serviceWindows.js";
import { normalizeMaxWaiting, rejectIfCapBelowOccupancy } from "./capacity.js";
import { isStaff, staffQueueIds, staffVenueId } from "./staffAccess.js";
import { DEFAULT_NO_SHOW_MINUTES } from "./servingDeadline.js";
import {
  DEFAULT_NO_SHOW_MODE,
  DEFAULT_NO_SHOW_MIN_MINUTES,
  DEFAULT_NO_SHOW_MAX_MINUTES,
  NO_SHOW_MODES,
  NO_SHOW_BOUND_MIN,
  NO_SHOW_BOUND_MAX,
} from "./noShowWindow.js";
import {
  DEFAULT_RECOVERY_MINUTES,
  DEFAULT_RECOVERY_PLACES,
  RECOVERY_MINUTES_MAX,
  RECOVERY_MINUTES_MIN,
  RECOVERY_PLACES_MAX,
  RECOVERY_PLACES_MIN,
} from "./missedTurn.js";
import {
  DEFAULT_PRIORITY_EVERY_K,
  PRIORITY_EVERY_K_MAX,
  PRIORITY_EVERY_K_MIN,
  regularServesSincePriorityOf,
} from "./priorityLane.js";
import { EQUIVALENT_GROUP_MAX, normalizeEquivalentGroup } from "./equivalentQueues.js";
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
export const NO_SHOW_MIN = 1;
export const NO_SHOW_MAX = 30;


export function cleanRecoveryMinutes(raw) {
  if (raw === undefined) return { omitted: true };
  if (raw === null || raw === "") return { value: DEFAULT_RECOVERY_MINUTES };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < RECOVERY_MINUTES_MIN || value > RECOVERY_MINUTES_MAX) {
    return {
      error: `Recovery window must be an integer from ${RECOVERY_MINUTES_MIN} to ${RECOVERY_MINUTES_MAX} minutes`,
    };
  }
  return { value };
}

export function cleanRecoveryPlaces(raw) {
  if (raw === undefined) return { omitted: true };
  if (raw === null || raw === "") return { value: DEFAULT_RECOVERY_PLACES };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < RECOVERY_PLACES_MIN || value > RECOVERY_PLACES_MAX) {
    return {
      error: `Recovery places must be an integer from ${RECOVERY_PLACES_MIN} to ${RECOVERY_PLACES_MAX}`,
    };
  }
  return { value };
}

export function cleanPriorityEveryK(raw) {
  if (raw === undefined) return { omitted: true };
  if (raw === null || raw === "") return { value: DEFAULT_PRIORITY_EVERY_K };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < PRIORITY_EVERY_K_MIN || value > PRIORITY_EVERY_K_MAX) {
    return {
      error: `Priority fairness must be an integer from ${PRIORITY_EVERY_K_MIN} to ${PRIORITY_EVERY_K_MAX} (1 means no cap)`,
    };
  }
  return { value };
}


export function cleanEquivalentGroup(raw) {
  if (raw === undefined) return { omitted: true };
  if (raw === null || raw === "") return { value: null };
  if (typeof raw !== "string") {
    return { error: "Equivalent group must be a short name, or empty for none" };
  }
  if (raw.trim().length > EQUIVALENT_GROUP_MAX) {
    return { error: `Equivalent group must be ${EQUIVALENT_GROUP_MAX} characters or fewer` };
  }
  return { value: normalizeEquivalentGroup(raw) };
}


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

/**
 * Parse no-show minutes. Omitted leaves the current value alone.
 * Empty / null defaults to 5. Must be an integer from 1 to 30.
 */
export function cleanNoShowMinutes(raw) {
  if (raw === undefined) return { omitted: true };
  if (raw === null || raw === "") return { value: DEFAULT_NO_SHOW_MINUTES };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < NO_SHOW_MIN || value > NO_SHOW_MAX) {
    return {
      error: `No-show minutes must be an integer from ${NO_SHOW_MIN} to ${NO_SHOW_MAX}, or empty for the default (${DEFAULT_NO_SHOW_MINUTES})`,
    };
  }
  return { value };
}

export function cleanNoShowMode(raw) {
  if (raw === undefined) return { omitted: true };
  if (raw === null || raw === "") return { value: DEFAULT_NO_SHOW_MODE };
  const value = String(raw).trim().toLowerCase();
  if (!NO_SHOW_MODES.includes(value)) {
    return { error: "No-show mode must be fixed or dynamic" };
  }
  return { value };
}

export function cleanNoShowBound(raw, { label, fallback }) {
  if (raw === undefined) return { omitted: true };
  if (raw === null || raw === "") return { value: fallback };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < NO_SHOW_BOUND_MIN || value > NO_SHOW_BOUND_MAX) {
    return {
      error: `${label} must be an integer from ${NO_SHOW_BOUND_MIN} to ${NO_SHOW_BOUND_MAX}`,
    };
  }
  return { value };
}

function applyNoShowBounds(queue, minResult, maxResult) {
  const min = minResult?.omitted ? (queue.noShowMinMinutes ?? DEFAULT_NO_SHOW_MIN_MINUTES) : minResult.value;
  const max = maxResult?.omitted ? (queue.noShowMaxMinutes ?? DEFAULT_NO_SHOW_MAX_MINUTES) : maxResult.value;
  if (min > max) {
    return { error: "No-show minimum cannot be greater than the maximum" };
  }
  if (!minResult?.omitted) queue.noShowMinMinutes = minResult.value;
  if (!maxResult?.omitted) queue.noShowMaxMinutes = maxResult.value;
  return { ok: true };
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
    organizationId: venue.organization ? venue.organization.toString() : null,
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

export async function listAdminCatalog(user) {
  const venueFilter = isStaff(user) && staffVenueId(user) ? { _id: staffVenueId(user) } : {};
  const queueFilter = isStaff(user) && staffVenueId(user) ? { venue: staffVenueId(user) } : {};
  const allowedQueues = staffQueueIds(user);
  if (allowedQueues) queueFilter._id = { $in: allowedQueues };
  const venues = await Venue.find(venueFilter).sort({ name: 1 }).exec();
  const queues = await Queue.find(queueFilter).sort({ name: 1 }).exec();
  const byVenue = new Map();
  for (const queue of queues) {
    const key = queue.venue?.toString();
    if (!byVenue.has(key)) byVenue.set(key, []);
    byVenue.get(key).push(queue);
  }
  return venues.map((venue) => toAdminVenueJSON(venue, byVenue.get(venue._id.toString()) || []));
}

export async function createVenue({ name, organization = null }) {
  const cleaned = cleanName(name, "Venue name");
  if (cleaned.error) return { ok: false, status: 400, error: cleaned.error };
  const slug = await uniqueVenueSlug(slugifyName(cleaned.name));
  const venue = await Venue.create({ name: cleaned.name, slug, organization });
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

export async function createQueue({ venueId, name, averageServiceTime, serviceWindows, counters, maxWaiting, noShowMinutes, noShowMode, noShowMinMinutes, noShowMaxMinutes, recoveryMinutes, recoveryPlaces, priorityEveryK, equivalentGroup }) {
  if (!venueId) return { ok: false, status: 400, error: "Venue is required" };
  const venue = await Venue.findById(venueId);
  if (!venue) return { ok: false, status: 404, error: "Venue not found" };

  const cleaned = cleanName(name, "Queue name");
  if (cleaned.error) return { ok: false, status: 400, error: cleaned.error };
  const pace = cleanServiceTime(averageServiceTime ?? 3);
  if (pace.error) return { ok: false, status: 400, error: pace.error };

  const cap = normalizeMaxWaiting(maxWaiting === undefined ? null : maxWaiting);
  if (cap.error) return { ok: false, status: 400, error: cap.error };

  const noShow = cleanNoShowMinutes(noShowMinutes === undefined ? DEFAULT_NO_SHOW_MINUTES : noShowMinutes);
  if (noShow.error) return { ok: false, status: 400, error: noShow.error };
  const mode = cleanNoShowMode(noShowMode === undefined ? DEFAULT_NO_SHOW_MODE : noShowMode);
  if (mode.error) return { ok: false, status: 400, error: mode.error };
  const minBound = cleanNoShowBound(
    noShowMinMinutes === undefined ? DEFAULT_NO_SHOW_MIN_MINUTES : noShowMinMinutes,
    { label: "No-show minimum", fallback: DEFAULT_NO_SHOW_MIN_MINUTES }
  );
  if (minBound.error) return { ok: false, status: 400, error: minBound.error };
  const maxBound = cleanNoShowBound(
    noShowMaxMinutes === undefined ? DEFAULT_NO_SHOW_MAX_MINUTES : noShowMaxMinutes,
    { label: "No-show maximum", fallback: DEFAULT_NO_SHOW_MAX_MINUTES }
  );
  if (maxBound.error) return { ok: false, status: 400, error: maxBound.error };
  if (minBound.value > maxBound.value) {
    return { ok: false, status: 400, error: "No-show minimum cannot be greater than the maximum" };
  }
  const recoveryMins = cleanRecoveryMinutes(
    recoveryMinutes === undefined ? DEFAULT_RECOVERY_MINUTES : recoveryMinutes
  );
  if (recoveryMins.error) return { ok: false, status: 400, error: recoveryMins.error };
  const recoveryN = cleanRecoveryPlaces(
    recoveryPlaces === undefined ? DEFAULT_RECOVERY_PLACES : recoveryPlaces
  );
  if (recoveryN.error) return { ok: false, status: 400, error: recoveryN.error };
  const priorityK = cleanPriorityEveryK(
    priorityEveryK === undefined ? DEFAULT_PRIORITY_EVERY_K : priorityEveryK
  );
  if (priorityK.error) return { ok: false, status: 400, error: priorityK.error };
  const group = cleanEquivalentGroup(equivalentGroup === undefined ? null : equivalentGroup);
  if (group.error) return { ok: false, status: 400, error: group.error };

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
    noShowMinutes: noShow.value,
    noShowMode: mode.value,
    noShowMinMinutes: minBound.value,
    noShowMaxMinutes: maxBound.value,
    recoveryMinutes: recoveryMins.value,
    recoveryPlaces: recoveryN.value,
    priorityEveryK: priorityK.value,
    regularServesSincePriority: Math.max(0, priorityK.value - 1),
    equivalentGroup: group.value,
    serviceWindows: windows,
    status: "open",
    acceptingTokens: true,
    counters: counterDocs,
    ...(cap.value != null ? { maxWaiting: cap.value } : {}),
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
  if (patch.noShowMinutes !== undefined) {
    const noShow = cleanNoShowMinutes(patch.noShowMinutes);
    if (noShow.error) return { ok: false, status: 400, error: noShow.error };
    if (!noShow.omitted) queue.noShowMinutes = noShow.value;
  }
  if (patch.noShowMode !== undefined) {
    const mode = cleanNoShowMode(patch.noShowMode);
    if (mode.error) return { ok: false, status: 400, error: mode.error };
    if (!mode.omitted) queue.noShowMode = mode.value;
  }
  if (patch.noShowMinMinutes !== undefined || patch.noShowMaxMinutes !== undefined) {
    const minBound = cleanNoShowBound(patch.noShowMinMinutes, {
      label: "No-show minimum",
      fallback: DEFAULT_NO_SHOW_MIN_MINUTES,
    });
    if (minBound.error) return { ok: false, status: 400, error: minBound.error };
    const maxBound = cleanNoShowBound(patch.noShowMaxMinutes, {
      label: "No-show maximum",
      fallback: DEFAULT_NO_SHOW_MAX_MINUTES,
    });
    if (maxBound.error) return { ok: false, status: 400, error: maxBound.error };
    const bounds = applyNoShowBounds(queue, minBound, maxBound);
    if (bounds.error) return { ok: false, status: 400, error: bounds.error };
  }
  if (patch.recoveryMinutes !== undefined) {
    const recovery = cleanRecoveryMinutes(patch.recoveryMinutes);
    if (recovery.error) return { ok: false, status: 400, error: recovery.error };
    if (!recovery.omitted) queue.recoveryMinutes = recovery.value;
  }
  if (patch.recoveryPlaces !== undefined) {
    const places = cleanRecoveryPlaces(patch.recoveryPlaces);
    if (places.error) return { ok: false, status: 400, error: places.error };
    if (!places.omitted) queue.recoveryPlaces = places.value;
  }
  if (patch.priorityEveryK !== undefined) {
    const priorityK = cleanPriorityEveryK(patch.priorityEveryK);
    if (priorityK.error) return { ok: false, status: 400, error: priorityK.error };
    if (!priorityK.omitted) {
      queue.priorityEveryK = priorityK.value;
      queue.regularServesSincePriority = Math.min(
        Math.max(0, priorityK.value - 1),
        regularServesSincePriorityOf(queue)
      );
    }
  }
  if (patch.equivalentGroup !== undefined) {
    const group = cleanEquivalentGroup(patch.equivalentGroup);
    if (group.error) return { ok: false, status: 400, error: group.error };
    if (!group.omitted) queue.equivalentGroup = group.value;
  }
  if (patch.guestJoin !== undefined) {
    if (typeof patch.guestJoin !== "boolean") {
      return { ok: false, status: 400, error: "guestJoin must be true or false" };
    }
    queue.guestJoin = patch.guestJoin;
  }
  const booking = applyAppointmentSettings(queue, patch);
  if (booking.error) return { ok: false, status: 400, error: booking.error };
  if (patch.maxWaiting !== undefined) {
    const cap = normalizeMaxWaiting(patch.maxWaiting);
    if (cap.error) return { ok: false, status: 400, error: cap.error };
    if (!cap.omitted) {
      if (cap.value != null) {
        const blocked = await rejectIfCapBelowOccupancy(queue, cap.value);
        if (blocked) return { ok: false, status: 409, error: blocked.error };
      }
      queue.maxWaiting = cap.value;
    }
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
