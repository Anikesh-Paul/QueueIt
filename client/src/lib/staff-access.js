/**
 * Client-side staff scope: venue, with an optional queue allow-list.
 * Empty or missing staffQueueIds means every queue in the venue.
 */
/** Admin with no organization limit (every admin before scoping existed). */
export function isGlobalAdmin(user) {
  return user?.role === "admin" && !(Array.isArray(user.adminOrganizationIds) && user.adminOrganizationIds.length);
}

/** Admin limited to some organizations. */
export function isOrgAdmin(user) {
  return user?.role === "admin" && Array.isArray(user.adminOrganizationIds) && user.adminOrganizationIds.length > 0;
}

/** Organization id of a venue/queue as the server stores it ("default" = Main campus). */
export function orgIdOf(venueOrQueue) {
  const venue = venueOrQueue?.venue && typeof venueOrQueue.venue === "object" ? venueOrQueue.venue : venueOrQueue;
  return venue?.organizationId || "default";
}

export function staffCanManageQueue(user, queue) {
  if (!user) return false;
  if (isGlobalAdmin(user)) return true;
  // The server enforces this too; the client only hides what would be refused.
  if (isOrgAdmin(user)) return user.adminOrganizationIds.includes(orgIdOf(queue));
  if (user.role !== "staff") return false;
  const venueId = queue?.venue?.id ?? queue?.venueId ?? null;
  if (!user.staffVenueId || venueId !== user.staffVenueId) return false;
  const allowed = Array.isArray(user.staffQueueIds) ? user.staffQueueIds : [];
  if (allowed.length === 0) return true;
  const queueId = queue?.id ?? queue?._id ?? null;
  return queueId != null && allowed.includes(String(queueId));
}
