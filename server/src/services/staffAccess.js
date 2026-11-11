/**
 * Venue-scoped staff vs global admin, with an optional queue allow-list.
 * `admin` is a break-glass role (seeded demo operator). `staff` may only
 * manage queues and settings for their assigned venue. An empty or missing
 * queue allow-list means every queue in that venue (today's behaviour).
 */

export const VENUE_FORBIDDEN = "You don't have access to this venue";
export const QUEUE_FORBIDDEN = "You don't have access to this queue";

export function isGlobalAdmin(user) {
  return user?.role === "admin";
}

export function isStaff(user) {
  return user?.role === "staff";
}

export function isConsoleUser(user) {
  return isGlobalAdmin(user) || isStaff(user);
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
  if (!isStaff(user) || venueId == null) return false;
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
  if (isGlobalAdmin(user)) return true;
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
