import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";
import { UserChip } from "@/components/shell/user-chip";
import { useApp } from "@/context/app-context";
import { cn } from "@/lib/utils";
import { shellNavEnd } from "@/lib/shell-nav";
import { QueueNotifyProvider } from "@/hooks/use-queue-notifications";
import { LanguageToggle } from "@/components/shell/language-toggle";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useI18n } from "@/context/i18n-context";
import { SkipToContent } from "@/components/shell/skip-to-content";
import { MAIN_CONTENT_ID } from "@/lib/skip-to-content";

function ShellNavLink({ to, end, children, testId }) {
  const exact = end ?? shellNavEnd(to);
  return (
    <NavLink
      to={to}
      end={exact}
      data-testid={testId}
      className={({ isActive }) =>
        cn(
          "relative inline-flex h-10 shrink-0 items-center whitespace-nowrap px-1 text-sm font-medium text-text-secondary transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
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

function ShellNavItems({ isAdmin, inQueue, openAdminQueueId, t }) {
  return (
    <>
      <ShellNavLink to="/queues" testId="nav-queues">
        {t("nav.queues")}
      </ShellNavLink>
      {/* Student / Guest path: History is not an admin surface */}
      {!isAdmin && (
        <ShellNavLink to="/history" testId="nav-history">
          {t("nav.history")}
        </ShellNavLink>
      )}
      {inQueue && (
        <ShellNavLink to="/status" testId="nav-in-line">
          {t("nav.inLine")}
        </ShellNavLink>
      )}
      {isAdmin && (
        <ShellNavLink to="/admin/catalog" testId="nav-catalog">
          Catalog
        </ShellNavLink>
      )}
      {isAdmin && (
        <ShellNavLink to="/admin/analytics" testId="nav-campus-analytics">
          Campus
        </ShellNavLink>
      )}
      {isAdmin && (
        <ShellNavLink to="/admin/shift" testId="nav-shift">
          Shift
        </ShellNavLink>
      )}
      {isAdmin && (
        <ShellNavLink to="/admin/notices" testId="nav-notices">
          Notices
        </ShellNavLink>
      )}
      {isAdmin && (
        <ShellNavLink to="/admin/audit" testId="nav-audit">
          Audit
        </ShellNavLink>
      )}
      {isAdmin && openAdminQueueId && (
        <>
          <ShellNavLink to={`/admin/queues/${openAdminQueueId}`} testId="nav-admin">
            Admin
          </ShellNavLink>
          <ShellNavLink
            to={`/admin/queues/${openAdminQueueId}/analytics`}
            testId="nav-analytics"
          >
            Analytics
          </ShellNavLink>
        </>
      )}
    </>
  );
}

/**
 * Shared hybrid chrome for User, Admin, and Guest.
 * Top bar only — page toolbars are composed by Live / Admin / Analytics pages.
 * On a phone the nav sits on its own row so labels like History and In line
 * are not clipped by the wordmark or account chip.
 */
export function AppShell() {
  const { user, isAdmin, isGuest, inQueue, adminQueueId, logout } = useApp();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const openAdminQueueId = resolveAdminQueueId(adminQueueId, pathname);

  // JWT User/Admin wins; otherwise Guest chip on the student peer path.
  const identity = user
    ? { name: user.name, role: user.role === "admin" || user.role === "staff" ? user.role : "user" }
    : isGuest
      ? { name: "Guest", role: "guest" }
      : null;
  const showLogout = Boolean(user);
  // Soft upgrade entry: Guest chip menu only (no persistent full-width banner).
  const guestSoftUpgrade = Boolean(isGuest && !user);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const navItems = (
    <ShellNavItems
      isAdmin={isAdmin}
      inQueue={inQueue}
      openAdminQueueId={openAdminQueueId}
      t={t}
    />
  );

  return (
    <QueueNotifyProvider>
    <div className="flex min-h-dvh flex-col bg-background">
      <SkipToContent />
      <header
        data-testid="app-top-bar"
        className="sticky top-0 z-40 border-b border-border bg-card"
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col sm:h-14 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
          <div className="flex h-14 items-center gap-3 px-4 sm:h-auto sm:flex-1 sm:px-0">
            <Wordmark />
            <nav
              aria-label={t("nav.main")}
              data-testid="shell-nav"
              className="hidden min-w-0 items-center gap-4 sm:flex"
            >
              {navItems}
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
              <ThemeToggle />
              <LanguageToggle />
              <UserChip user={identity} softUpgrade={guestSoftUpgrade} />
              {showLogout ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="whitespace-nowrap"
                  data-testid="shell-logout"
                >
                  {t("nav.logOut")}
                </Button>
              ) : null}
            </div>
          </div>
          <nav
            aria-label={t("nav.main")}
            data-testid="shell-nav-mobile"
            className="flex items-center gap-4 overflow-x-auto px-4 pb-1 sm:hidden"
          >
            {navItems}
          </nav>
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
    </div>
    </QueueNotifyProvider>
  );
}
