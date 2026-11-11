import { cn } from "@/lib/utils";

/**
 * Honest live-update connection chip.
 * “realtime” when the Socket.IO connection is live, “polling” for the
 * always-on fallback, “offline” when the tab or last fetch is offline.
 * The copy must never claim push when only polling is running, or Live
 * updates when the student is offline (DESIGN.md honesty rule).
 */
export function RealtimeIndicator({ connected, mode, className, testId }) {
  const resolved = mode || (connected ? "realtime" : "polling");
  return (
    <span
      data-testid={testId}
      aria-live="polite"
      className={cn(
        "shrink-0",
        resolved === "realtime" && "font-semibold text-success",
        resolved === "offline" && "font-semibold text-text-secondary",
        className
      )}
    >
      · {resolved}
    </span>
  );
}
