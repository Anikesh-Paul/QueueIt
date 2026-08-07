import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useApp } from "@/context/app-context";
import { cn } from "@/lib/utils";

function formatNowServing(value) {
  if (value === null || value === undefined) return "—";
  return String(value);
}

/**
 * Live status — the signature surface. Hero Token metric, supporting
 * Position / ETA / Now serving, honest polling copy, calm Live/Paused pill.
 */
export function StatusPage() {
  const {
    token,
    user,
    inQueue,
    liveStatus,
    statusQueueId,
    statusQueueName,
    statusUpdating,
    statusError,
    refreshStatus,
    leave,
    leaveBusy,
    leaveError,
  } = useAppStatus();
  const navigate = useNavigate();

  // Membership ended (served / left / expired) — back to the catalog.
  useEffect(() => {
    if (!inQueue) navigate("/queues", { replace: true });
  }, [inQueue, navigate]);

  if (!inQueue || !liveStatus) return null;

  const paused = liveStatus.queue?.status === "paused";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <h1 className="font-heading text-display leading-tight text-foreground">
          Your place in line
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Token {liveStatus.tokenNumber} · {liveStatus.queue?.name || statusQueueName}
        </p>
      </header>

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="font-heading text-sm font-semibold text-foreground">
              {liveStatus.queue?.name || statusQueueName}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              Updates every few seconds
              {statusUpdating ? " · refreshing…" : ""}
            </p>
          </div>
          {paused ? (
            <span
              aria-live="polite"
              data-testid="queue-paused"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#FEF3C7] px-2.5 py-1 text-xs font-semibold text-[#92400E]"
            >
              <span className="size-1.5 rounded-full bg-[#D97706]" />
              Paused
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary-muted px-2.5 py-1 text-xs font-semibold text-primary">
              <span className="size-1.5 rounded-full bg-primary" />
              Live
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 px-5 py-5 sm:grid-cols-3">
          <StatusMetric
            label="Token"
            value={liveStatus.tokenNumber}
            hero
            testId="token-number"
            className="sm:col-span-1"
          />
          <StatusMetric label="Position" value={liveStatus.position} testId="position" />
          <StatusMetric
            label="ETA"
            value={
              <>
                {liveStatus.etaMinutes}
                <span className="ml-0.5 text-base font-medium text-text-muted">min</span>
              </>
            }
            testId="eta"
          />
          <StatusMetric
            label="Now serving"
            value={formatNowServing(liveStatus.nowServing)}
            testId="now-serving"
          />
        </div>

        <p className="border-t border-border px-5 py-3 text-xs text-text-muted">
          ETA = position × {liveStatus.averageServiceTime} min per serve
          {paused ? " · line paused (advancement frozen)" : ""}
        </p>

        {(statusError || leaveError) && (
          <div className="px-5 pb-4">
            {statusError && <Alert variant="destructive">{statusError}</Alert>}
            {leaveError && <Alert variant="destructive">{leaveError}</Alert>}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="lg"
                disabled={leaveBusy}
                data-testid="leave-queue"
                className="w-full border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive sm:w-auto"
              >
                {leaveBusy ? "Leaving…" : "Leave queue"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave your place in line?</AlertDialogTitle>
                <AlertDialogDescription>
                  You&apos;ll free your spot and lose this token. You can rejoin
                  the line later if plans change.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep my place</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={async () => {
                    const ok = await leave();
                    if (ok) navigate("/queues");
                  }}
                >
                  Leave
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => refreshStatus(token, statusQueueId)}
              disabled={statusUpdating}
            >
              Refresh status
            </Button>
            {user?.role !== "admin" && (
              <Button variant="secondary" size="sm" onClick={() => navigate("/history")}>
                View history
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function StatusMetric({ label, value, hero = false, testId, className }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-border bg-secondary px-4 py-3",
        hero && "bg-primary-muted/70",
        className
      )}
    >
      <span className="text-label uppercase tracking-wide text-text-muted">{label}</span>
      <span
        data-testid={testId}
        className={cn(
          "font-heading text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground",
          hero && "text-3xl text-primary"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function useAppStatus() {
  const app = useApp();
  const { queues, statusQueueId } = app;
  const statusQueueName =
    app.liveStatus?.queue?.name ||
    queues.find((q) => q.id === statusQueueId)?.name ||
    "Queue";
  return { ...app, statusQueueName };
}