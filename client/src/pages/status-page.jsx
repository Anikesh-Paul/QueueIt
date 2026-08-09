import { useEffect, useState } from "react";
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

/** Quiet relative age for polling honesty (no heavy date libs). */
function formatStatusAge(updatedAt, nowMs) {
  if (updatedAt == null) return null;
  const sec = Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
  // Age-only fragments: cadence already says "Updates" on the line.
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
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
    statusLastUpdatedAt,
    statusUpdating,
    statusError,
    refreshStatus,
    leave,
    leaveBusy,
    leaveError,
  } = useAppStatus();
  const navigate = useNavigate();
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Membership ended (served / left / expired) — back to the catalog.
  useEffect(() => {
    if (!inQueue) navigate("/queues", { replace: true });
  }, [inQueue, navigate]);

  // Tick relative age while open (interval, not CSS animation — fine for reduced-motion).
  useEffect(() => {
    if (!inQueue || statusLastUpdatedAt == null) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [inQueue, statusLastUpdatedAt]);

  if (!inQueue || !liveStatus) return null;

  const paused = liveStatus.queue?.status === "paused";
  const ageLabel = formatStatusAge(statusLastUpdatedAt, nowMs);
  const queueTitle = liveStatus.queue?.name || statusQueueName;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <h1 className="font-heading text-display leading-tight text-foreground">
          Your place in line
        </h1>
      </header>

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-sm font-semibold text-foreground">
              {queueTitle}
            </p>
            <p className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs leading-5 text-text-muted">
              <span className="shrink-0">Updates every few seconds</span>
              {ageLabel ? (
                <span
                  className="inline-block min-w-[4.75rem] shrink-0 tabular-nums tracking-tight text-text-muted"
                  title={
                    statusLastUpdatedAt
                      ? `Last successful update ${new Date(statusLastUpdatedAt).toLocaleTimeString()}`
                      : undefined
                  }
                >
                  · {ageLabel}
                </span>
              ) : null}
              {statusUpdating ? (
                <span aria-live="polite" className="shrink-0">
                  · Updating…
                </span>
              ) : null}
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

        <div className="flex flex-col gap-4 px-5 py-5">
          <StatusMetric
            label="Token"
            value={liveStatus.tokenNumber}
            hero
            testId="token-number"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-stretch">
            <StatusMetric label="Position" value={liveStatus.position} testId="position" />
            <StatusMetric
              label="ETA"
              value={
                <>
                  {liveStatus.etaMinutes}
                  <span className="ml-1 text-sm font-medium tracking-normal text-text-muted">
                    min
                  </span>
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

        {/* Utilities first; Leave last (full-width on mobile, trailing on sm+). */}
        <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
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

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={leaveBusy}
                data-testid="leave-queue"
                className="w-full shrink-0 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive sm:w-auto"
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
              {/* Stay preferred first on all breakpoints (overrides default col-reverse). */}
              <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
                <AlertDialogCancel>Keep my place</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructiveSolid"
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
        </div>
      </section>
    </div>
  );
}

function StatusMetric({ label, value, hero = false, testId }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-1 rounded-lg border border-border bg-secondary px-4 py-3",
        hero &&
          "min-h-[6.5rem] justify-center gap-1.5 bg-primary-muted px-6 py-5 sm:min-h-[7rem]"
      )}
    >
      <span
        className={cn(
          "text-label uppercase tracking-wide text-text-muted",
          hero && "font-semibold text-primary"
        )}
      >
        {label}
      </span>
      <span
        data-testid={testId}
        className={cn(
          "inline-flex items-baseline font-heading text-metric tabular-nums text-foreground",
          hero &&
            "text-[2.75rem] font-bold leading-[1.05] tracking-[-0.02em] text-primary sm:text-[3rem]"
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
