import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { useApp } from "@/context/app-context";
import { cn } from "@/lib/utils";

/**
 * Queue catalog — joinable queues for the seeded venue. Full-width pressable
 * rows with a clear selected state; per-role action (Join vs Manage).
 */
export function QueuesPage() {
  const {
    token,
    isAdmin,
    queues,
    queuesLoading,
    queuesError,
    selectedQueueId,
    setSelectedQueueId,
    setJoinError,
    loadQueues,
    joinBusy,
    joinError,
    join,
    openAdminConsole,
    inQueue,
  } = useApp();
  const navigate = useNavigate();

  // Session restore can resolve an active membership after the router landed
  // on /queues — bounce queued users back to their live status view.
  useEffect(() => {
    if (inQueue) navigate("/status", { replace: true });
  }, [inQueue, navigate]);

  const selected = queues.find((q) => q.id === selectedQueueId) || null;

  async function handleJoin() {
    if (!selectedQueueId || joinBusy) return;
    const ok = await join(selectedQueueId);
    if (ok) navigate("/status");
  }

  async function handleManage() {
    if (!selectedQueueId) return;
    setJoinError("");
    await openAdminConsole(selectedQueueId);
    navigate(`/admin/queues/${selectedQueueId}`);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-display leading-tight text-foreground">
            Available queues
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Join from your phone — get a token, position, and a live wait estimate.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => loadQueues(token)}
          disabled={queuesLoading}
          className="hidden sm:inline-flex"
        >
          Refresh
        </Button>
      </header>

      {queuesLoading && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading queues">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      )}

      {!queuesLoading && queuesError && (
        <Alert variant="destructive">{queuesError}</Alert>
      )}

      {!queuesLoading && !queuesError && queues.length === 0 && (
        <div className="rounded-xl border border-border bg-card px-5 py-10 text-center shadow-card">
          <p className="font-heading text-sm font-medium text-foreground">No queues are open yet</p>
          <p className="mt-1 text-sm text-text-secondary">
            Run <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">npm run seed</code>{" "}
            on the server, then refresh.
          </p>
        </div>
      )}

      {!queuesLoading && !queuesError && queues.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Queue catalog">
          {queues.map((queue) => {
            const isSelected = queue.id === selectedQueueId;
            return (
              <li key={queue.id}>
                <button
                  type="button"
                  className={cn(
                    "queue-card flex w-full flex-col items-start gap-0.5 rounded-lg border bg-card px-4 py-3 text-left shadow-card transition-[border,background-color] outline-none hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/50",
                    isSelected && "border-primary bg-primary-muted/60"
                  )}
                  onClick={() => {
                    setSelectedQueueId(queue.id);
                    setJoinError("");
                  }}
                  aria-pressed={isSelected}
                >
                  <span className="font-heading text-title text-foreground">{queue.name}</span>
                  <span className="text-sm text-text-muted">
                    {queue.venue?.name || "Venue"} · ~{queue.averageServiceTime} min per serve
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div
          role="status"
          className="mt-5 flex flex-col gap-4 rounded-lg border border-primary/30 bg-primary-muted/40 p-5 shadow-card sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-heading text-sm font-medium text-foreground">
              You selected {selected.name}
              {selected.venue?.name ? ` at ${selected.venue.name}` : ""}.
            </p>
            <p className="mt-0.5 text-sm text-text-secondary">
              {isAdmin
                ? "Open the console to see the waiting list and serve, skip, or pause."
                : "Join to get a token and a live wait estimate."}
            </p>
          </div>
          {isAdmin ? (
            <Button
              size="lg"
              onClick={handleManage}
              data-testid="open-admin-console"
              className="w-full sm:w-auto"
            >
              Manage {selected.name}
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={handleJoin}
              disabled={joinBusy}
              className="w-full sm:w-auto"
            >
              {joinBusy ? "Joining…" : `Join ${selected.name}`}
            </Button>
          )}
        </div>
      )}

      {joinError && <Alert variant="destructive" className="mt-4">{joinError}</Alert>}

      {!selected && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
          <span>Choose a queue above to continue.</span>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => loadQueues(token)}
          disabled={queuesLoading}
          className="sm:hidden"
        >
          Refresh
        </Button>
        {!isAdmin && (
          <Button variant="secondary" size="sm" onClick={() => navigate("/history")}>
            View history
          </Button>
        )}
      </div>
    </div>
  );
}