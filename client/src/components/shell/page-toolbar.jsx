import { cn } from "@/lib/utils";

/**
 * Optional page toolbar under the global top bar.
 * Only Live status, Admin console, and Analytics use this (DESIGN.md).
 * Catalog, History, and Auth stay without a sub-header.
 *
 * Holds open-queue context, live/polling honesty, status pill, and secondary actions.
 * Does not claim WebSocket push when only polling is active — honesty nodes are callers' job.
 */
export function PageToolbar({
  title,
  meta,
  status,
  actions,
  tier = "student",
  className,
  "data-testid": testId = "page-toolbar",
}) {
  return (
    <div
      data-testid={testId}
      data-shell-tier={tier}
      className={cn(
        "sticky top-14 z-30 border-b border-border bg-card/90 backdrop-blur-sm",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6",
          tier === "admin" ? "max-w-6xl" : "max-w-3xl"
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title ? (
            <div className="truncate font-heading text-sm font-semibold text-foreground">
              {title}
            </div>
          ) : null}
          {meta ? (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs leading-5 text-text-muted">
              {meta}
            </div>
          ) : null}
        </div>
        {status ? <div className="flex shrink-0 items-center gap-2">{status}</div> : null}
        {actions ? (
          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
