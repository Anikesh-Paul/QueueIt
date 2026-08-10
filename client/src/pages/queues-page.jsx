import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { useApp, SOFT_UPGRADE_POST_LEAVE_KEY } from "@/context/app-context";
import { ShellContent } from "@/components/shell/shell-content";
import { MotifIllustration } from "@/components/brand/motif-illustration";
import { SoftUpgradePrompt } from "@/components/shell/soft-upgrade-prompt";
import { cn } from "@/lib/utils";

/**
 * Queue catalog — joinable queues for the seeded venue.
 * Ruthless copy: H1 Queues, button context only (no selection essays).
 * Guest may see a one-shot soft-upgrade reinforce after leave (not a banner).
 */
export function QueuesPage() {
  const {
    token,
    guestCredential,
    isGuest,
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
  const [showPostLeaveUpgrade, setShowPostLeaveUpgrade] = useState(() => {
    if (typeof sessionStorage === "undefined") return false;
    try {
      return sessionStorage.getItem(SOFT_UPGRADE_POST_LEAVE_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Session restore can resolve an active membership after the router landed
  // on /queues — bounce queued users back to their live status view.
  useEffect(() => {
    if (inQueue) navigate("/status", { replace: true });
  }, [inQueue, navigate]);

  // Soft upgrade clears Guest path — drop any leftover post-leave reinforce.
  useEffect(() => {
    if (!isGuest && showPostLeaveUpgrade) {
      dismissPostLeaveUpgrade();
    }
  }, [isGuest, showPostLeaveUpgrade]);

  function dismissPostLeaveUpgrade() {
    try {
      sessionStorage.removeItem(SOFT_UPGRADE_POST_LEAVE_KEY);
    } catch {
      // ignore
    }
    setShowPostLeaveUpgrade(false);
  }

  const selected = queues.find((q) => q.id === selectedQueueId) || null;

  function refreshCatalog() {
    loadQueues(token || null, { guestCred: guestCredential || null });
  }

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
    <ShellContent tier="student">
      <header className="mb-6 flex items-end justify-between gap-4">
        <h1
          data-testid="queues-heading"
          className="font-heading text-headline leading-tight text-foreground"
        >
          Queues
        </h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={refreshCatalog}
          disabled={queuesLoading}
          className="hidden sm:inline-flex"
          data-testid="queues-refresh"
        >
          Refresh
        </Button>
      </header>

      {isGuest && showPostLeaveUpgrade ? (
        <div className="mb-5" data-testid="soft-upgrade-post-leave">
          <SoftUpgradePrompt onNavigate={dismissPostLeaveUpgrade} />
        </div>
      ) : null}

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
        <div
          data-testid="queues-empty"
          className="rounded-xl border border-border bg-card px-5 py-10 text-center shadow-card"
        >
          <MotifIllustration motif="waitingHall" variant="empty" className="mb-4" />
          <p className="font-display text-display font-semibold tracking-[-0.01em] text-foreground">
            No queues open
          </p>
          <p className="mt-1 text-sm text-text-secondary">Seed the server, then refresh.</p>
        </div>
      )}

      {!queuesLoading && !queuesError && queues.length > 0 && (
        <ul
          className="flex flex-col gap-3"
          aria-label="Queue catalog"
          data-testid="queue-catalog"
        >
          {queues.map((queue) => {
            const isSelected = queue.id === selectedQueueId;
            return (
              <li key={queue.id}>
                <button
                  type="button"
                  data-testid="queue-card"
                  data-queue-id={queue.id}
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
                    {queue.venue?.name || "Venue"} · ~{queue.averageServiceTime} min
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
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
              data-testid="join-queue"
              className="w-full sm:w-auto"
            >
              {joinBusy ? "Joining…" : `Join ${selected.name}`}
            </Button>
          )}
        </div>
      )}

      {joinError && <Alert variant="destructive" className="mt-4">{joinError}</Alert>}

      <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={refreshCatalog}
          disabled={queuesLoading}
          className="sm:hidden"
          data-testid="queues-refresh-mobile"
        >
          Refresh
        </Button>
        {!isAdmin && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("/history")}
            data-testid="view-history"
          >
            View history
          </Button>
        )}
      </div>
    </ShellContent>
  );
}
