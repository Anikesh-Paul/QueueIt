import { Badge as BadgePrimitive } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Not widely: tiny initial-based avatar + name + role badge.
 * The name is its own text node so `getByText("Demo User", { exact: true })`
 * matches the chip (Playwright smoke contract).
 */
export function UserChip({ user, className }) {
  if (!user) return null;
  const isAdmin = user.role === "admin";
  const initials = (user.name || "?")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card py-1 pr-1 pl-1 shadow-card",
        className
      )}
    >
      <span className="grid size-6 place-items-center rounded-full bg-primary-muted text-[0.6875rem] font-semibold text-primary">
        {initials}
      </span>
      <span className="hidden max-w-32 truncate text-sm font-medium text-foreground sm:block">
        {user.name}
      </span>
      <RoleBadge role={isAdmin ? "admin" : "user"} />
    </div>
  );
}

/**
 * Role chip — forest mist wash for user, warm amber for admin (identity, not error).
 */
export function RoleBadge({ role, className }) {
  const isAdmin = role === "admin";
  return (
    <BadgePrimitive
      className={cn(
        "rounded-full text-xs font-semibold lowercase",
        isAdmin
          ? "badge--admin border-transparent bg-[#FEF3C7] text-[#92400E]"
          : "badge--user border-transparent bg-primary-muted text-primary",
        className
      )}
    >
      {role}
    </BadgePrimitive>
  );
}