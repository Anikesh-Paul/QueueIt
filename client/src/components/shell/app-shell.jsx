import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";
import { UserChip } from "@/components/shell/user-chip";
import { useApp } from "@/context/app-context";
import { cn } from "@/lib/utils";

function ShellNavLink({ to, end = false, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "relative inline-flex h-10 shrink-0 items-center px-1 text-sm font-medium text-text-secondary transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          "after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary after:transition-transform",
          isActive ? "text-foreground after:scale-x-100" : "after:scale-x-0"
        )
      }
    >
      {children}
    </NavLink>
  );
}

/** Prefer open console id; fall back to route so Analytics stays navigable after console unmount. */
function resolveAdminQueueId(adminQueueId, pathname) {
  if (adminQueueId) return adminQueueId;
  const match = String(pathname || "").match(/^\/admin\/queues\/([^/]+)/);
  return match?.[1] || null;
}

/**
 * Shared hybrid chrome for User, Admin, and (later) Guest.
 * Top bar only — page toolbars are composed by Live / Admin / Analytics pages.
 * Primitives stay session-shape agnostic so P5 can reuse without JWT-only assumptions.
 */
export function AppShell() {
  const { user, isAdmin, inQueue, adminQueueId, logout } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const openAdminQueueId = resolveAdminQueueId(adminQueueId, pathname);

  // JWT session today; Guest identity may render the same chip without a JWT (P5).
  const identity = user
    ? { name: user.name, role: user.role === "admin" ? "admin" : "user" }
    : null;
  const showLogout = Boolean(user);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header
        data-testid="app-top-bar"
        className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm"
      >
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Wordmark />
          <nav
            aria-label="Main"
            data-testid="shell-nav"
            className="flex min-w-0 items-center gap-1 overflow-x-auto sm:gap-4"
          >
            <ShellNavLink to="/queues">Queues</ShellNavLink>
            {/* Student / Guest path: History is not an admin surface */}
            {!isAdmin && <ShellNavLink to="/history">History</ShellNavLink>}
            {inQueue && <ShellNavLink to="/status">In line</ShellNavLink>}
            {isAdmin && openAdminQueueId && (
              <>
                <ShellNavLink to={`/admin/queues/${openAdminQueueId}`}>Admin</ShellNavLink>
                <ShellNavLink to={`/admin/queues/${openAdminQueueId}/analytics`}>
                  Analytics
                </ShellNavLink>
              </>
            )}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <UserChip user={identity} />
            {showLogout ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="whitespace-nowrap"
                data-testid="shell-logout"
              >
                Log out
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
