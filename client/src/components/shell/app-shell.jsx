import { NavLink, Outlet, useNavigate } from "react-router-dom";
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
          isActive
            ? "text-foreground after:scale-x-100"
            : "after:scale-x-0"
        )
      }
    >
      {children}
    </NavLink>
  );
}

/**
 * Shared app chrome: wordmark, role-aware nav, user chip, logout.
 * One shell for both roles (no separate student/admin skin).
 */
export function AppShell() {
  const { user, isAdmin, inQueue, adminQueueId, logout } = useApp();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Wordmark />
          <nav
            aria-label="Main"
            className="flex min-w-0 items-center gap-1 overflow-x-auto sm:gap-4"
          >
            <ShellNavLink to="/queues">Queues</ShellNavLink>
            {!isAdmin && <ShellNavLink to="/history">History</ShellNavLink>}
            {inQueue && (
              <ShellNavLink to="/status">Your place in line</ShellNavLink>
            )}
            {isAdmin && adminQueueId && (
              <>
                <ShellNavLink to={`/admin/queues/${adminQueueId}`}>
                  Admin console
                </ShellNavLink>
                <ShellNavLink to={`/admin/queues/${adminQueueId}/analytics`}>
                  Analytics
                </ShellNavLink>
              </>
            )}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <UserChip user={user} />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="whitespace-nowrap"
            >
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}