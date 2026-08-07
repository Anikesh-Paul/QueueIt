import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useApp } from "@/context/app-context";

/**
 * Route guards for the role-aware route table.
 * - RequireAuth:  no session -> /login (keeps the attempted location for later).
 * - RequireUser:  admin must not see user-only surfaces -> /queues.
 * - RequireAdmin: non-admins may not open the admin console -> /queues.
 * - RequireGuest: already signed in, no point re-entering auth -> "/".
 */
export function RequireAuth() {
  const { token, user, booting } = useApp();
  const location = useLocation();

  if (booting) return null;
  if (!token || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function RequireUser() {
  const { isAdmin } = useApp();
  if (isAdmin) return <Navigate to="/queues" replace />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { isAdmin } = useApp();
  if (!isAdmin) return <Navigate to="/queues" replace />;
  return <Outlet />;
}

export function RequireGuest() {
  const { token, user } = useApp();
  if (token && user) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** "/" for signed-in users: in queue -> /status, otherwise the catalog. */
export function HomeRedirect() {
  const { inQueue, isAdmin } = useApp();
  const target = !isAdmin && inQueue ? "/status" : "/queues";
  return <Navigate to={target} replace />;
}