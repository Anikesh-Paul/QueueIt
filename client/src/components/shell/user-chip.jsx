import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge as BadgePrimitive } from "@/components/ui/badge";
import { SoftUpgradePrompt } from "@/components/shell/soft-upgrade-prompt";
import { cn } from "@/lib/utils";
import {
  identityChipLabel,
  normalizeIdentityRole,
  shouldShowRoleBadge,
} from "@/lib/identity-chip";
import { useI18n } from "@/context/i18n-context";

/** Display labels for identity chips — title case per DESIGN.md. */
const ROLE_LABELS = {
  user: "User",
  admin: "Admin",
  staff: "Staff",
  guest: "Guest",
};

/**
 * Identity chip for the shared shell.
 * Guest: opens soft-upgrade chip menu (locked copy). User/Admin: static chip.
 * Callers pass `{ name, role }` where role is `user` | `admin` | `staff` | `guest`.
 */
export function UserChip({ user, className, softUpgrade = false, href = null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onDocPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const { t } = useI18n();
  if (!user) return null;
  const role = normalizeIdentityRole(user.role);
  const rawLabel = identityChipLabel(user);
  const label =
    rawLabel === "Guest" ? t("role.guest") : rawLabel === "Account" ? t("role.account") : rawLabel;
  const showRoleBadge = shouldShowRoleBadge(role, rawLabel);
  const initials = initialsFrom(label);
  const isGuestChip = role === "guest" && softUpgrade;

  const chipBody = (
    <>
      <span className="grid size-6 place-items-center rounded-full bg-primary-muted text-[0.6875rem] font-semibold text-primary">
        {initials}
      </span>
      <span
        data-testid="identity-name"
        className="max-w-[7rem] truncate text-sm font-medium text-foreground max-[419px]:sr-only sm:max-w-32"
      >
        {label}
      </span>
      {showRoleBadge ? <RoleBadge role={role} label={user.roleLabel} /> : null}
    </>
  );

  if (!isGuestChip && href) {
    return (
      <Link
        to={href}
        data-testid="identity-chip"
        data-role={role}
        title={t("security.link")}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card py-1 pr-1 pl-1 shadow-card",
          "outline-none transition-colors hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50",
          className
        )}
      >
        {chipBody}
        <span className="sr-only">{` — ${t("security.link")}`}</span>
      </Link>
    );
  }

  if (!isGuestChip) {
    return (
      <div
        data-testid="identity-chip"
        data-role={role}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card py-1 pr-1 pl-1 shadow-card",
          className
        )}
      >
        {chipBody}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        data-testid="identity-chip"
        data-role={role}
        data-menu-open={menuOpen ? "true" : "false"}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        onClick={() => setMenuOpen((open) => !open)}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card py-1 pr-1 pl-1 shadow-card",
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          menuOpen && "ring-2 ring-ring/40"
        )}
      >
        {chipBody}
      </button>
      {menuOpen ? (
        <div
          id={menuId}
          role="menu"
          data-testid="soft-upgrade-menu"
          className="absolute right-0 top-full z-50 mt-2 w-64"
        >
          <SoftUpgradePrompt
            testId="soft-upgrade-menu-body"
            onNavigate={() => setMenuOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Role chip — forest for User, warm amber for Admin, neutral mist for Guest (identity, not error).
 * Title case labels: User / Admin / Guest. Class hooks stay for e2e (`.badge--user` etc.).
 */
export function RoleBadge({ role, className, label: override = null }) {
  const { t } = useI18n();
  const normalized = normalizeIdentityRole(role);
  const label = override ||
    (normalized === "guest"
      ? t("role.guest")
      : normalized === "user"
        ? t("role.user")
        : ROLE_LABELS[normalized] || ROLE_LABELS.user);

  return (
    <BadgePrimitive
      className={cn(
        "rounded-full text-xs font-semibold normal-case",
        badgeClassFor(normalized),
        className
      )}
    >
      {label}
    </BadgePrimitive>
  );
}

function badgeClassFor(role) {
  if (role === "admin") {
    return "badge--admin border-transparent bg-warning-soft text-warning-ink";
  }
  if (role === "staff") {
    return "badge--staff border-transparent bg-info-soft text-info-ink";
  }
  if (role === "guest") {
    return "badge--guest border-transparent bg-secondary text-text-secondary";
  }
  return "badge--user border-transparent bg-primary-muted text-primary";
}

function initialsFrom(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
