/**
 * Venue-scoped staff vs global admin.
 * `admin` is a break-glass role (seeded demo operator). `staff` may only
 * manage queues and settings for their assigned venue.
 */

export const VENUE_FORBIDDEN = "You don't have access to this venue";

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
