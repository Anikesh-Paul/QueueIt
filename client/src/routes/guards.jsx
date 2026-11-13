import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useApp } from "@/context/app-context";
import { homeRedirectTarget } from "@/lib/home-redirect";
import { peekAuthFlash } from "@/lib/auth-flash";

/**
 * Route guards for the role-aware route table.
 * - RequireShellAccess: JWT User/Admin or Guest path (mode/credential).
 * - RequireUser: admin must not see user-only surfaces; Guest OK.
 * - RequireAdmin: non-admins (including Guest) may not open admin console.
 * - RequireLoggedOut: already signed in as User/Admin → "/".
 */
export function RequireShellAccess() {
  const { token, user, isGuest, booting } = useApp();
  const location = useLocation();

  if (booting) return null;
  if ((token && user) || isGuest) {
    return <Outlet />;
  }
  return <Navigate to="/login" replace state={{ from: location.pathname }} />;
}

export function RequireUser() {
  const { isAdmin } = useApp();
  if (isAdmin) return <Navigate to="/queues" replace />;
  return <Outlet />;
}

/** Account pages need a real sign-in (not the Guest path). */
export function RequireSignedIn() {
  const { token, user } = useApp();
  const location = useLocation();
  if (token && user) return <Outlet />;
  return <Navigate to="/login" replace state={{ from: location.pathname }} />;
}

export function RequireAdmin() {
  const { isAdmin } = useApp();
  if (!isAdmin) return <Navigate to="/queues" replace />;
  return <Outlet />;
}

/** Auth pages: only when not signed in as User/Admin. Guest may still open login (soft upgrade later). */
export function RequireLoggedOut() {
  const { token, user } = useApp();
  if (token && user) return <Navigate to={peekAuthFlash()?.to || "/"} replace />;
  return <Outlet />;
}

/** Backward-compatible alias used by older imports. */
export const RequireGuest = RequireLoggedOut;

/** "/" for signed-in User/Admin or Guest: in queue -> /status, otherwise the catalog. */
export function HomeRedirect() {
  const { inQueue, isAdmin, user, isGuest, membershipsReady } = useApp();
  const target = homeRedirectTarget({
    user,
    isGuest,
    isAdmin,
    inQueue,
    membershipsReady,
  });
  if (!target) return null;
  return <Navigate to={target} replace />;
}


/**
 * Poster join links are public: if the visitor has no session yet, enter
 * Guest mode so they can join without a detour through the login form.
 */
export function JoinSessionGate() {
  const { booting, token, user, isGuest, enterGuestMode } = useApp();

  useEffect(() => {
    if (booting) return;
    if ((token && user) || isGuest) return;
    enterGuestMode();
  }, [booting, token, user, isGuest, enterGuestMode]);

  if (booting) return null;
  if ((token && user) || isGuest) return <Outlet />;
  return null;
}
