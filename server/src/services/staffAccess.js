/**
 * Who may manage what.
 *
 * - Global admin: role `admin` with no organization scope (every admin that
 *   existed before scoping, and the seeded demo operator). Sees everything.
 * - Organization admin: role `admin` with `adminOrganizations` set. Manages
 *   only venues (and their queues, staff, notices, analytics, audit and
 *   shifts) inside those organizations. The venue list is resolved once per
 *   request by `loadAccessScope`; if it was never loaded, access fails closed.
 * - Staff: one venue, with an optional queue allow-list (empty = whole venue).
 */
import { Venue } from "../models/Venue.js";

export const VENUE_FORBIDDEN = "You don't have access to this venue";
export const QUEUE_FORBIDDEN = "You don't have access to this queue";
export const ORG_FORBIDDEN = "You don't have access to this organization";
export const DEFAULT_ORG_KEY = "default";

export function isAdminRole(user) {
  return user?.role === "admin";
}

/** Organization ids an admin is limited to, or null (global / not an admin). */
export function adminOrgIds(user) {
  if (!isAdminRole(user)) return null;
  const ids = (user.adminOrganizations || []).map((id) => String(id).trim()).filter(Boolean);
  return ids.length ? [...new Set(ids)] : null;
}

export function isOrgAdmin(user) {
  return adminOrgIds(user) !== null;
}

/** Unrestricted admin. Missing / empty organization scope means global. */
export function isGlobalAdmin(user) {
  return isAdminRole(user) && !isOrgAdmin(user);
}

function scopeOf(user) {
  return user?.$locals?.accessScope || user?.accessScope || null;
}

/**
 * Resolve an organization admin's venues and remember them on the user
 * object for this request. No-op for everyone else.
 */
export async function loadAccessScope(user) {
  const orgs = adminOrgIds(user);
  if (!orgs) return null;
  const or = [];
  if (orgs.includes(DEFAULT_ORG_KEY)) or.push({ organization: null });
  const objectIds = orgs.filter((id) => /^[a-f0-9]{24}$/i.test(id));
  if (objectIds.length) or.push({ organization: { $in: objectIds } });
  const venues = or.length ? await Venue.find({ $or: or }).select("_id") : [];
  const scope = { orgIds: orgs, venueIds: venues.map((v) => String(v._id)) };
  if (user.$locals) user.$locals.accessScope = scope;
  else user.accessScope = scope;
  return scope;
}

/** Venue ids an org admin may manage ([] when the scope was never loaded). */
export function orgAdminVenueIds(user) {
  if (!isOrgAdmin(user)) return null;
  return scopeOf(user)?.venueIds || [];
}

/**
 * Venues this console user is limited to: null = unrestricted (global admin),
 * otherwise a list (staff: their one venue; org admin: their organizations').
 */
export function scopedVenueIds(user) {
  if (isGlobalAdmin(user)) return null;
  if (isOrgAdmin(user)) return orgAdminVenueIds(user);
  if (isStaff(user)) return user.staffVenue ? [String(user.staffVenue)] : [];
  return [];
}

/** Whether this console user may act on an organization ("default" or id). */
export function canAccessOrg(user, orgId) {
  if (isGlobalAdmin(user)) return true;
  const orgs = adminOrgIds(user);
  return Boolean(orgs && orgId != null && orgs.includes(String(orgId)));
}

export function isStaff(user) {
  return user?.role === "staff";
}

export function isConsoleUser(user) {
  return isAdminRole(user) || isStaff(user);
}

export function staffVenueId(user) {
  if (!isStaff(user) || user.staffVenue == null) return null;
  return String(user.staffVenue);
}

/**
 * Allowed queue ids for a staff user, or null when they may manage every
 * queue in their venue (empty / missing allow-list).
 */
export function staffQueueIds(user) {
  if (!isStaff(user)) return null;
  const ids = (user.staffQueues || []).map((id) => String(id)).filter(Boolean);
  return ids.length ? ids : null;
}

export function canAccessVenue(user, venueId) {
  if (isGlobalAdmin(user)) return true;
  if (venueId == null) return false;
  if (isOrgAdmin(user)) return orgAdminVenueIds(user).includes(String(venueId?._id ?? venueId));
  if (!isStaff(user)) return false;
  return staffVenueId(user) === String(venueId);
}

/** Send 403 and return true when the user cannot manage this venue. */
export function forbidUnlessVenueAccess(user, venueId, res) {
  if (canAccessVenue(user, venueId)) return false;
  res.status(403).json({ error: VENUE_FORBIDDEN });
  return true;
}

export function canAccessQueue(user, queue) {
  if (!queue) return false;
  const venueId = queue.venue?._id ?? queue.venue;
  if (!canAccessVenue(user, venueId)) return false;
  if (isAdminRole(user)) return true;
  const allowed = staffQueueIds(user);
  if (!allowed) return true;
  const queueId = queue._id ?? queue.id;
  return queueId != null && allowed.includes(String(queueId));
}

/**
 * Send 403 and return true when the user cannot manage this queue.
 * Off-venue staff still get the venue message so existing tests stay stable.
 */
export function forbidUnlessQueueAccess(user, queue, res) {
  if (canAccessQueue(user, queue)) return false;
  const venueId = queue?.venue?._id ?? queue?.venue;
  if (!canAccessVenue(user, venueId)) {
    res.status(403).json({ error: VENUE_FORBIDDEN });
    return true;
  }
  res.status(403).json({ error: QUEUE_FORBIDDEN });
  return true;
}

/**
 * Venue filter for a console read (analytics, reports). Staff are pinned to
 * their venue; org admins to their organizations' venues; asking for a venue
 * outside the scope is 403.
 * @returns {Promise<{ ok: true, filter: object, venue: object | null } | { ok: false, status: number, error: string }>}
 */
export async function resolveVenueFilter(user, venueParam = null) {
  const limit = scopedVenueIds(user);
  if (limit && isStaff(user) && !limit.length) return { ok: false, status: 403, error: VENUE_FORBIDDEN };
  if (venueParam) {
    if (limit && !limit.includes(String(venueParam))) return { ok: false, status: 403, error: VENUE_FORBIDDEN };
    if (!/^[a-f0-9]{24}$/i.test(String(venueParam))) return { ok: false, status: 404, error: "Venue not found" };
    const venue = await Venue.findById(venueParam);
    if (!venue) return { ok: false, status: 404, error: "Venue not found" };
    return { ok: true, filter: { venue: venue._id }, venue };
  }
  if (isStaff(user)) {
    const venue = await Venue.findById(limit[0]);
    if (!venue) return { ok: false, status: 403, error: VENUE_FORBIDDEN };
    return { ok: true, filter: { venue: venue._id }, venue };
  }
  if (limit) return { ok: true, filter: { venue: { $in: limit } }, venue: null };
  return { ok: true, filter: {}, venue: null };
}
