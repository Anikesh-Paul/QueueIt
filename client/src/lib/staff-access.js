/**
 * Client-side staff scope: venue, with an optional queue allow-list.
 * Empty or missing staffQueueIds means every queue in the venue.
 */
export function staffCanManageQueue(user, queue) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role !== "staff") return false;
  const venueId = queue?.venue?.id ?? queue?.venueId ?? null;
  if (!user.staffVenueId || venueId !== user.staffVenueId) return false;
  const allowed = Array.isArray(user.staffQueueIds) ? user.staffQueueIds : [];
  if (allowed.length === 0) return true;
  const queueId = queue?.id ?? queue?._id ?? null;
  return queueId != null && allowed.includes(String(queueId));
}
