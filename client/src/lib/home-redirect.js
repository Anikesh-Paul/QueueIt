/**
 * Choose the signed-in home route.
 * Wait (return null) until memberships have been restored so an in-line
 * student is not sent to /queues once and left there.
 */
export function homeRedirectTarget({
  user,
  isGuest,
  isAdmin,
  inQueue,
  membershipsReady,
} = {}) {
  if (!user && !isGuest) return "/login";
  if (isAdmin) return "/queues";
  if (!membershipsReady) return null;
  return inQueue ? "/status" : "/queues";
}
