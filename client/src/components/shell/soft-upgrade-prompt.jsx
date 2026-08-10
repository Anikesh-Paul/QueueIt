import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Soft upgrade affordance — locked copy only.
 * Keep your history · Register or log in on this device.
 * Compact card (not a persistent full-width banner).
 */
export function SoftUpgradePrompt({ className, testId = "soft-upgrade-prompt", onNavigate }) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-3 shadow-card",
        className
      )}
    >
      <p className="font-heading text-sm font-semibold text-foreground">Keep your history</p>
      <p className="mt-0.5 text-xs text-text-secondary">Register or log in on this device.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm" data-testid="soft-upgrade-register">
          <Link to="/register" onClick={onNavigate}>
            Register
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" data-testid="soft-upgrade-login">
          <Link to="/login" onClick={onNavigate}>
            Log in
          </Link>
        </Button>
      </div>
    </div>
  );
}
