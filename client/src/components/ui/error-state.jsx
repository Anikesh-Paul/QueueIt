import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Recoverable error card: says what failed in plain words, keeps the raw
 * server message secondary, and offers a retry.
 */
export function ErrorState({ title, message, detail, onRetry, retryLabel = "Try again", busy = false, className, testId = "error-state" }) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn("flex flex-col items-start gap-3 rounded-md border border-destructive/30 bg-card px-5 py-4 shadow-card sm:flex-row sm:items-center", className)}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger-ink" aria-hidden="true">
        <AlertTriangle className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{title}</p>
        {message ? <p className="mt-0.5 text-sm text-text-secondary">{message}</p> : null}
        {detail ? <p className="mt-0.5 text-xs text-text-muted">{detail}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={busy} data-testid={`${testId}-retry`}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
