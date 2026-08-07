import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { useApp } from "@/context/app-context";
import { cn } from "@/lib/utils";

function formatEventTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}

function formatOutcomeLabel(outcome) {
  if (!outcome) return "—";
  return String(outcome).charAt(0).toUpperCase() + String(outcome).slice(1);
}

/**
 * A user's own queue history (joined / left / served / skipped).
 * History nav is a user-role surface only.
 */
export function HistoryPage() {
  const { token, historyEvents, historyLoading, historyError, loadHistory } = useApp();

  useEffect(() => {
    if (token) loadHistory(token);
  }, [token, loadHistory]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-display leading-tight text-foreground">
            Your queue history
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Past and current queue events — joined, left, served, and skipped.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => loadHistory(token)}
          disabled={historyLoading}
          className="hidden sm:inline-flex"
        >
          Refresh
        </Button>
      </header>

      {historyLoading && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading history">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      )}

      {!historyLoading && historyError && <Alert variant="destructive">{historyError}</Alert>}

      {!historyLoading && !historyError && historyEvents.length === 0 && (
        <div
          data-testid="history-empty"
          className="rounded-xl border border-border bg-card px-5 py-12 text-center shadow-card"
        >
          <p className="font-heading text-sm font-semibold text-foreground">
            Your history is quiet for now
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            No queue events yet. Join a line to start your history.
          </p>
        </div>
      )}

      {!historyLoading && !historyError && historyEvents.length > 0 && (
        <ul className="flex flex-col gap-3" data-testid="history-list" aria-label="Queue history">
          {historyEvents.map((event) => (
            <li
              key={event.id}
              data-testid="history-item"
              data-outcome={event.outcome}
              className="rounded-xl border border-border bg-card p-4 shadow-card"
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    outcomeTone(event.outcome)
                  )}
                  data-testid="history-outcome"
                >
                  {formatOutcomeLabel(event.outcome)}
                </span>
                <span className="text-xs font-semibold text-text-secondary">
                  Token {event.tokenNumber}
                </span>
              </div>
              <p className="mt-2 font-heading text-sm font-medium text-foreground">
                {event.queue?.name || "Queue"}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {formatEventTime(
                  event.outcome === "joined" ? event.joinedAt : event.updatedAt || event.joinedAt
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function outcomeTone(outcome) {
  switch (outcome) {
    case "joined":
      return "bg-primary-muted text-primary";
    case "served":
      return "bg-emerald-100 text-emerald-700";
    case "skipped":
      return "bg-[#FEF3C7] text-[#92400E]";
    default:
      return "bg-secondary text-text-secondary";
  }
}