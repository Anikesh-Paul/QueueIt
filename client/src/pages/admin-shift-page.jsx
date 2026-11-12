import { useCallback, useEffect, useState } from "react";
import { Coffee, LogOut, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { PageToolbar } from "@/components/shell/page-toolbar";
import { ShellContent } from "@/components/shell/shell-content";
import { useApp } from "@/context/app-context";
import { fetchShiftBoard, shiftAction } from "@/api";
import { formatCampusClockTime } from "@/lib/campus-time";
import { ACTION_LABEL, STATE_LABEL, counterActions, effectivePace, staffingSummary } from "@/lib/shifts";
import { cn } from "@/lib/utils";

const PILL = {
  open: "bg-success/12 text-success",
  break: "bg-warning-soft text-warning-ink",
  closed: "bg-secondary text-text-muted",
};

const ICON = { start: Play, break: Coffee, back: RotateCcw, end: LogOut };

function StatePill({ state }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold", PILL[state] || PILL.closed)}
      data-testid="shift-state"
      data-state={state}
    >
      <span className={cn("size-1.5 rounded-full", state === "open" ? "bg-success" : state === "break" ? "bg-attention" : "bg-text-muted")} aria-hidden="true" />
      {STATE_LABEL[state] || state}
    </span>
  );
}

/**
 * Staff shift view: who is on which counter, breaks, and one-tap shift changes.
 * Counter state drives where calls go and how long the line's wait looks.
 */
export function AdminShiftPage() {
  const { token, user } = useApp();
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState(null);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setBoard(await fetchShiftBoard(token));
    } catch (err) {
      setError(err.message || "Couldn't load shifts");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(queueId, counterId, action) {
    const key = `${counterId}:${action}`;
    setBusyKey(key);
    setActionError("");
    try {
      const data = await shiftAction(token, queueId, counterId, action);
      setBoard(data.board);
    } catch (err) {
      setActionError(err.message || "That didn't work. Try again.");
    } finally {
      setBusyKey(null);
    }
  }

  const me = board?.me;
  const meId = user?.id;

  return (
    <>
      <PageToolbar
        tier="admin"
        title="Shift"
        meta="Campus time (IST)"
        actions={
          <Button variant="ghost" size="sm" onClick={load} disabled={loading} data-testid="shift-refresh">
            Refresh
          </Button>
        }
      />
      <ShellContent tier="admin">
        <header className="mb-5">
          <h1 data-testid="shift-heading" className="font-heading text-headline leading-tight text-foreground">
            Your shift
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Calls only go to open counters. Breaks close your counter and lengthen the wait people see until you&apos;re back.
          </p>
        </header>

        {loading && !board ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading shifts">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
        ) : null}

        {error && !board ? (
          <ErrorState testId="shift-error" title="Couldn't load shifts" message={error} retryLabel="Try again" onRetry={load} />
        ) : null}

        {board ? (
          <div className="flex flex-col gap-4">
            <section
              data-testid="shift-me"
              aria-labelledby="shift-me-title"
              className={cn(
                "rounded-lg border bg-card px-5 py-4 shadow-card",
                me?.state === "break" ? "border-warning-line" : me ? "border-l-4 border-border border-l-primary" : "border-border"
              )}
            >
              {me ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 id="shift-me-title" className="font-heading text-base font-semibold text-foreground">
                        {me.queue.name} · {me.counter.name}
                      </h2>
                      <StatePill state={me.state} />
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">
                      {me.state === "break" ? "On a break" : "On shift"}
                      {me.since ? ` since ${formatCampusClockTime(me.since)}` : ""}
                      {me.queue.venue ? ` · ${me.queue.venue}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(me.state === "break" ? ["back", "end"] : ["break", "end"]).map((action) => {
                      const Icon = ICON[action];
                      return (
                        <Button
                          key={action}
                          size="sm"
                          variant={action === "end" ? "outline" : "default"}
                          disabled={Boolean(busyKey)}
                          onClick={() => act(me.queue.id, me.counter.id, action)}
                          data-testid={`shift-me-${action}`}
                        >
                          <Icon className="size-4" aria-hidden="true" />
                          {ACTION_LABEL[action]}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <h2 id="shift-me-title" className="font-heading text-base font-semibold text-foreground">
                    You&apos;re not on a counter
                  </h2>
                  <p className="mt-1 text-sm text-text-secondary">Pick a counter below to start your shift.</p>
                </div>
              )}
            </section>

            {actionError ? (
              <p role="alert" className="text-sm text-danger-ink" data-testid="shift-action-error">
                {actionError}
              </p>
            ) : null}

            {board.queues.length === 0 ? (
              <p className="rounded-lg border border-border bg-card px-5 py-8 text-center text-sm text-text-muted">
                No queues to staff yet.
              </p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {board.queues.map((queue) => {
                  const pace = effectivePace(queue);
                  return (
                    <section
                      key={queue.id}
                      data-testid="shift-queue"
                      aria-labelledby={`shift-q-${queue.id}`}
                      className="overflow-hidden rounded-lg border border-border bg-card shadow-card"
                    >
                      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-5 py-3">
                        <h2 id={`shift-q-${queue.id}`} className="text-sm font-semibold text-foreground">
                          {queue.name}
                          {queue.venue ? <span className="ml-1.5 font-normal text-text-muted">· {queue.venue}</span> : null}
                        </h2>
                        <p className="text-xs text-text-muted" data-testid="shift-queue-summary">
                          {staffingSummary(queue)} · {queue.waiting} waiting
                          {pace ? ` · ~${pace} min each` : ""}
                        </p>
                      </header>
                      <ul className="divide-y divide-border">
                        {queue.counters.map((counter) => {
                          const mine = Boolean(meId && counter.staffedBy?.id === meId);
                          const actions = counterActions(counter, { meId, onShift: Boolean(me) });
                          return (
                            <li
                              key={counter.id}
                              data-testid="shift-counter"
                              data-mine={mine ? "true" : undefined}
                              className={cn("flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center", mine && "bg-primary-muted/40")}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-foreground">{counter.name}</span>
                                  <StatePill state={counter.state} />
                                </div>
                                <p className="mt-0.5 text-xs text-text-muted">
                                  {counter.staffedBy
                                    ? `${mine ? "You" : counter.staffedBy.name || "Staff"}${counter.stateSince ? ` · since ${formatCampusClockTime(counter.stateSince)}` : ""}`
                                    : counter.state === "closed"
                                      ? "Nobody on this counter"
                                      : "Open, nobody signed in"}
                                  {counter.nowServing != null ? ` · calling ${counter.nowServing}` : ""}
                                </p>
                              </div>
                              {actions.length ? (
                                <div className="flex flex-wrap gap-2">
                                  {actions.map((action) => (
                                    <Button
                                      key={action}
                                      size="sm"
                                      variant={action === "start" || action === "back" ? "secondary" : "ghost"}
                                      disabled={Boolean(busyKey)}
                                      onClick={() => act(queue.id, counter.id, action)}
                                      data-testid={`shift-${action}`}
                                    >
                                      {busyKey === `${counter.id}:${action}` ? "Saving…" : ACTION_LABEL[action]}
                                    </Button>
                                  ))}
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </ShellContent>
    </>
  );
}
