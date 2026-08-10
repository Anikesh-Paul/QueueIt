import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { useApp } from "@/context/app-context";
import { ShellContent } from "@/components/shell/shell-content";
import { MotifIllustration } from "@/components/brand/motif-illustration";
import { formatCampusDateTime } from "@/lib/campus-time";
import { cn } from "@/lib/utils";

function formatOutcomeLabel(outcome) {
  if (!outcome) return "—";
  return String(outcome).charAt(0).toUpperCase() + String(outcome).slice(1);
}

/**
 * History (User, portable) or device-local history (Guest, this device).
 * Same surface + IST formatter; soft upgrade (09) later merges onto User History.
 * Ruthless copy: H1 History; empty primary + one secondary only.
 */
export function HistoryPage() {
  const { token, guestCredential, historyEvents, historyLoading, historyError, loadHistory } =
    useApp();

  useEffect(() => {
    if (token || guestCredential) {
      loadHistory(token || null, guestCredential || null);
    }
  }, [token, guestCredential, loadHistory]);

  return (
    <ShellContent tier="student">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1
          data-testid="history-heading"
          className="font-heading text-headline leading-tight text-foreground"
        >
          History
        </h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => loadHistory(token || null, guestCredential || null)}
          disabled={historyLoading}
          className="hidden sm:inline-flex"
          data-testid="history-refresh"
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
          <MotifIllustration motif="foldedPass" variant="empty" className="mb-4" />
          <p className="font-display text-display font-semibold tracking-[-0.01em] text-foreground">
            No history yet
          </p>
          <p className="mt-1 text-sm text-text-secondary">Join a queue to start one.</p>
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
              <p className="mt-0.5 text-xs text-text-muted" data-testid="history-event-time">
                {formatCampusDateTime(
                  event.outcome === "joined" ? event.joinedAt : event.updatedAt || event.joinedAt
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </ShellContent>
  );
}

function outcomeTone(outcome) {
  switch (outcome) {
    case "joined":
      return "bg-primary-muted text-primary";
    case "served":
      return "bg-primary-muted text-success";
    case "skipped":
      return "bg-[#FEF3C7] text-[#92400E]";
    default:
      return "bg-secondary text-text-secondary";
  }
}
