/** Sentinel: render the public landing page at "/" instead of redirecting. */
export const HOME_LANDING = "landing";

/**
 * Choose what "/" shows.
 * - Signed out → the public landing page (HOME_LANDING).
 * - Admin → the catalog straight away.
 * - User / Guest → wait (null) until memberships are restored, so an in-line
 *   visitor is not sent elsewhere once and left there; then /status when in
 *   line, otherwise /queues (User) or the landing page (Guest).
 */
export function homeRedirectTarget({
  user,
  isGuest,
  isAdmin,
  inQueue,
  membershipsReady,
} = {}) {
  if (!user && !isGuest) return HOME_LANDING;
  if (isAdmin) return "/queues";
  if (!membershipsReady) return null;
  if (inQueue) return "/status";
  return user ? "/queues" : HOME_LANDING;
}
