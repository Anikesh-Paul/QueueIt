import { cn } from "@/lib/utils";

/**
 * Honest live-update connection chip: “realtime” when the Socket.IO connection
 * is live, “polling” for the always-on fallback. The copy must never claim
 * push when only polling is running (DESIGN.md honesty rule).
 */
export function RealtimeIndicator({ connected, className, testId }) {
  return (
    <span
      data-testid={testId}
      aria-live="polite"
      className={cn("shrink-0", connected && "font-semibold text-success", className)}
    >
      · {connected ? "realtime" : "polling"}
    </span>
  );
}
