/**
 * Whether a shell NavLink should match only the exact path (`end`).
 * The admin console href `/admin/queues/:id` is a prefix of
 * `/admin/queues/:id/analytics`, so it must be exact or both look current.
 */
export function shellNavEnd(to) {
  return /^\/admin\/queues\/[^/]+$/.test(String(to || ""));
}
