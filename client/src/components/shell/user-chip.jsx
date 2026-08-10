import { Badge as BadgePrimitive } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Display labels for identity chips — title case per DESIGN.md. */
const ROLE_LABELS = {
  user: "User",
  admin: "Admin",
  guest: "Guest",
};

/**
 * Identity chip for the shared shell.
 * Works for JWT User/Admin today and Guest later (P5) — does not assume JWT-only forever.
 * Callers pass `{ name, role }` where role is `user` | `admin` | `guest`.
 * The name is its own text node so `getByText("Demo User", { exact: true })` matches (smoke).
 */
export function UserChip({ user, className }) {
  if (!user) return null;
  const role = normalizeRole(user.role);
  const label = user.name?.trim() || (role === "guest" ? "Guest" : "Account");
  const initials = initialsFrom(label);

  return (
    <div
      data-testid="identity-chip"
      data-role={role}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card py-1 pr-1 pl-1 shadow-card",
        className
      )}
    >
      <span className="grid size-6 place-items-center rounded-full bg-primary-muted text-[0.6875rem] font-semibold text-primary">
        {initials}
      </span>
      <span className="hidden max-w-32 truncate text-sm font-medium text-foreground sm:block">
        {label}
      </span>
      <RoleBadge role={role} />
    </div>
  );
}

/**
 * Role chip — forest for User, warm amber for Admin, neutral mist for Guest (identity, not error).
 * Title case labels: User / Admin / Guest. Class hooks stay for e2e (`.badge--user` etc.).
 */
export function RoleBadge({ role, className }) {
  const normalized = normalizeRole(role);
  const label = ROLE_LABELS[normalized] || ROLE_LABELS.user;

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

function normalizeRole(role) {
  const value = String(role || "user").toLowerCase();
  if (value === "admin") return "admin";
  if (value === "guest") return "guest";
  return "user";
}

function badgeClassFor(role) {
  if (role === "admin") {
    return "badge--admin border-transparent bg-[#FEF3C7] text-[#92400E]";
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
