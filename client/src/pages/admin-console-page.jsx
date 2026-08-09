import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { useApp } from "@/context/app-context";
import { cn } from "@/lib/utils";

function formatNowServing(value) {
  if (value === null || value === undefined) return "—";
  return String(value);
}

/**
 * Admin console — medium-density waiting list for one queue with Serve / Skip
 * / Pause / Resume controls, plus walk-in for counter arrivals without app join.
 * Explicit busy + disabled states; inline errors.
 * No "Admin API ok/denied" diagnostics in the production surface.
 */
export function AdminConsolePage() {
  const { queueId } = useParams();
  const navigate = useNavigate();
  const {
    openAdminConsole,
    clearAdminConsole,
    adminQueueMeta,
    waitingList,
    waitingLoading,
    waitingError,
    adminActionBusy,
    adminActionError,
    selectedEntryId,
    setSelectedEntryId,
    adminServe,
    adminSkip,
    adminPause,
    adminResume,
    adminWalkIn,
  } = useApp();

  const [walkInName, setWalkInName] = useState("");
  const [walkInToken, setWalkInToken] = useState("");

  useEffect(() => {
    if (queueId) openAdminConsole(queueId);
  }, [queueId, openAdminConsole]);

  useEffect(() => () => clearAdminConsole(), [clearAdminConsole]);

  const paused = adminQueueMeta?.status === "paused";
  const queueName = adminQueueMeta?.name || "Queue";
  const empty = waitingList.length === 0;

  async function handleWalkIn(event) {
    event.preventDefault();
    if (adminActionBusy) return;
    const name = walkInName.trim();
    if (!name) return;
    const payload = { name };
    if (walkInToken.trim() !== "") {
      payload.tokenNumber = walkInToken.trim();
    }
    const ok = await adminWalkIn(payload);
    if (ok) {
      setWalkInName("");
      setWalkInToken("");
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-display leading-tight text-foreground">
            Admin control
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Serve, skip, or pause {queueName} — the list updates every few seconds.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/queues")}>
          Back to queues
        </Button>
      </header>

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="font-heading text-sm font-semibold text-foreground">
              <span data-testid="admin-queue-name">{queueName}</span>
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              Waiting list updates every few seconds
              {waitingLoading ? " · loading…" : ""}
            </p>
          </div>
          <span
            data-testid="admin-queue-status"
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
              paused ? "bg-[#FEF3C7] text-[#92400E]" : "bg-primary-muted text-primary"
            )}
          >
            <span className={cn("size-1.5 rounded-full", paused ? "bg-[#D97706]" : "bg-primary")} />
            {paused ? "Paused" : "Open"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 px-5 py-5 sm:max-w-sm">
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-secondary px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Now serving
            </span>
            <span
              className="font-heading text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground"
              data-testid="admin-now-serving"
            >
              {formatNowServing(adminQueueMeta?.nowServing)}
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-secondary px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Waiting
            </span>
            <span
              className="font-heading text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground"
              data-testid="admin-waiting-count"
            >
              {waitingList.length}
            </span>
          </div>
        </div>

        <div className="border-t border-border px-5 py-4">
          <div
            className="admin-actions grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
            data-testid="admin-actions"
          >
            <Button
              variant="default"
              size="lg"
              onClick={() => adminServe(selectedEntryId || undefined)}
              disabled={adminActionBusy || paused || empty}
              data-testid="admin-serve"
              className="w-full sm:w-auto"
            >
              {adminActionBusy
                ? "Working…"
                : selectedEntryId
                  ? "Serve selected"
                  : "Serve next"}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => adminSkip(selectedEntryId || undefined)}
              disabled={adminActionBusy || paused || empty}
              data-testid="admin-skip"
              className="w-full sm:w-auto"
            >
              {adminActionBusy
                ? "Working…"
                : selectedEntryId
                  ? "Skip selected"
                  : "Skip next"}
            </Button>
            {paused ? (
              <Button
                variant="outline"
                size="lg"
                onClick={adminResume}
                disabled={adminActionBusy}
                data-testid="admin-resume"
                className="col-span-2 w-full sm:col-auto sm:ml-auto sm:w-auto"
              >
                {adminActionBusy ? "Working…" : "Resume"}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="lg"
                onClick={adminPause}
                disabled={adminActionBusy}
                data-testid="admin-pause"
                className="col-span-2 w-full sm:col-auto sm:ml-auto sm:w-auto"
              >
                {adminActionBusy ? "Working…" : "Pause"}
              </Button>
            )}
          </div>

          {(waitingError || adminActionError) && (
            <div className="mt-3 flex flex-col gap-2">
              {waitingError && <Alert variant="destructive">{waitingError}</Alert>}
              {adminActionError && (
                <Alert variant="destructive" data-testid="admin-action-error">
                  {adminActionError}
                </Alert>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-5">
          <h2 className="text-label uppercase tracking-wide text-text-muted">Add walk-in</h2>
          <p className="mt-1 text-xs text-text-muted">
            Counter arrival without the app — name required; token optional (auto if blank).
          </p>
          <form
            className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
            onSubmit={handleWalkIn}
            data-testid="walk-in-form"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:min-w-[12rem]">
              <Label htmlFor="walk-in-name">Name</Label>
              <Input
                id="walk-in-name"
                name="walkInName"
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                placeholder="Name at counter"
                required
                maxLength={80}
                disabled={adminActionBusy}
                data-testid="walk-in-name"
                className="h-10"
              />
            </div>
            <div className="flex w-full flex-col gap-1.5 sm:w-28">
              <Label htmlFor="walk-in-token">Token (optional)</Label>
              <Input
                id="walk-in-token"
                name="walkInToken"
                type="number"
                min={1}
                step={1}
                value={walkInToken}
                onChange={(e) => setWalkInToken(e.target.value)}
                placeholder="Auto"
                disabled={adminActionBusy}
                data-testid="walk-in-token"
                className="h-10"
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="lg"
              disabled={adminActionBusy || !walkInName.trim()}
              data-testid="walk-in-submit"
              className="w-full sm:w-auto"
            >
              {adminActionBusy ? "Working…" : "Add walk-in"}
            </Button>
          </form>
        </div>

        <div className="border-t border-border px-5 py-5">
          <h2 className="text-label uppercase tracking-wide text-text-muted">Waiting list</h2>

          {waitingLoading && (
            <div className="mt-3 flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
            </div>
          )}

          {!waitingLoading && empty && (
            <p className="mt-3 text-sm text-text-muted" data-testid="admin-waiting-empty">
              No one waiting.
            </p>
          )}

          {!waitingLoading && !empty && (
            <ul className="mt-3 flex flex-col gap-2" data-testid="admin-waiting-list">
              {waitingList.map((entry) => {
                const isSelected = entry.id === selectedEntryId;
                const isWalkIn = Boolean(entry.isWalkIn);
                const displayName = entry.user?.name || (isWalkIn ? "Walk-in" : "User");
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border border-border bg-secondary px-3.5 py-2.5 text-left shadow-card outline-none transition-[border,background-color] hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/50",
                        isSelected && "border-primary bg-primary-muted/60"
                      )}
                      onClick={() =>
                        setSelectedEntryId((prev) => (prev === entry.id ? null : entry.id))
                      }
                      aria-pressed={isSelected}
                      data-testid="waiting-entry"
                      data-token={entry.tokenNumber}
                      data-walk-in={isWalkIn ? "true" : "false"}
                    >
                      <span className="w-10 shrink-0 font-heading text-base font-bold tabular-nums text-foreground">
                        #{entry.tokenNumber}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {displayName}
                          {isWalkIn ? (
                            <span className="ml-1.5 text-xs font-semibold text-text-muted">
                              · Walk-in
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-text-muted">
                          Position {entry.position}
                          {entry.user?.email ? ` · ${entry.user.email}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}