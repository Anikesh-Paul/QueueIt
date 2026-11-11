import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { ErrorState } from "@/components/ui/error-state";
import { useApp, SOFT_UPGRADE_POST_LEAVE_KEY } from "@/context/app-context";
import { ShellContent } from "@/components/shell/shell-content";
import { MotifIllustration } from "@/components/brand/motif-illustration";
import { SoftUpgradePrompt } from "@/components/shell/soft-upgrade-prompt";
import { formatCampusDateTime } from "@/lib/campus-time";
import { describeTodayException } from "@/lib/service-exceptions";
import { formatWaitingOccupancy } from "@/lib/waiting-occupancy";
import { formatCatalogServing } from "@/lib/now-serving";
import { isQueueId, joinPath } from "@/lib/join-link";
import { cn } from "@/lib/utils";
import { useI18n } from "@/context/i18n-context";
import { staffCanManageQueue } from "@/lib/staff-access";
import { OpenWatchControls } from "@/components/status/open-watch-controls";

/**
 * Queue catalog — joinable queues for the seeded venue.
 * Ruthless copy: H1 Queues, button context only (no selection essays).
 * Guest may see a one-shot soft-upgrade reinforce after leave (not a banner).
 */
export function QueuesPage() {
  const { t, locale } = useI18n();
  const {
    token,
    guestCredential,
    isGuest,
    isAdmin,
    user,
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
    activeMemberships,
    selectMembership,
  } = useApp();
  const navigate = useNavigate();
  function canManageQueue(queue) {
    if (!isAdmin) return false;
    return staffCanManageQueue(user, queue);
  }
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const target = searchParams.get("join");
    const path = isQueueId(target) ? joinPath(target) : null;
    if (path) navigate(path, { replace: true });
  }, [searchParams, navigate]);

  const [showPostLeaveUpgrade, setShowPostLeaveUpgrade] = useState(() => {
    if (typeof sessionStorage === "undefined") return false;
    try {
      return sessionStorage.getItem(SOFT_UPGRADE_POST_LEAVE_KEY) === "1";
    } catch {
      return false;
    }
  });

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

  async function handleViewPlace(queueId) {
    await selectMembership(queueId);
    navigate("/status");
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
          {t("queues.title")}
        </h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={refreshCatalog}
          disabled={queuesLoading}
          className="hidden sm:inline-flex"
          data-testid="queues-refresh"
        >
          {t("common.refresh")}
        </Button>
      </header>

      {isGuest && showPostLeaveUpgrade ? (
        <div className="mb-5" data-testid="soft-upgrade-post-leave">
          <SoftUpgradePrompt onNavigate={dismissPostLeaveUpgrade} />
        </div>
      ) : null}

      {queuesLoading && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label={t("queues.loading")}>
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      )}

      {!queuesLoading && queuesError && (
        <ErrorState
          testId="queues-error"
          title={t("error.loadQueues")}
          message={t("error.connection")}
          detail={queuesError}
          retryLabel={t("error.retry")}
          onRetry={() => loadQueues(token || null, { guestCred: guestCredential || null })}
        />
      )}

      {!queuesLoading && !queuesError && queues.length === 0 && (
        <div
          data-testid="queues-empty"
          className="rounded-md border border-border bg-card px-5 py-10 text-center shadow-card"
        >
          <MotifIllustration motif="waitingHall" variant="empty" className="mb-4" />
          <p className="font-display text-display font-semibold tracking-[-0.01em] text-foreground">
            {t("queues.empty")}
          </p>
          <p className="mt-1 text-sm text-text-secondary">{t("queues.emptyHint")}</p>
        </div>
      )}

      {!queuesLoading && !queuesError && queues.length > 0 && (
        <ul
          className="flex flex-col gap-3"
          aria-label={t("queues.catalogLabel")}
          data-testid="queue-catalog"
        >
          {queues.map((queue) => {
            const isSelected = queue.id === selectedQueueId;
            const closed = queue.acceptingTokens === false;
            const paused = queue.status === "paused";
            const full = queue.full === true;
            // Closed, Full, and Paused are orthogonal — Closed/Full affect join; Paused can still show beside them.
            const primaryLabel = closed ? t("state.closed") : full ? t("state.full") : paused ? t("state.paused") : t("state.open");
            const occupancyLine = formatWaitingOccupancy({ ...queue, locale });
            const servingLine = formatCatalogServing({ ...queue, locale });
            const primaryTestId = closed
              ? "queue-state-closed"
              : full
                ? "queue-state-full"
                : paused
                  ? "queue-state-paused"
                  : "queue-state-open";
            return (
              <li key={queue.id}>
                <div
                  className={cn(
                    "overflow-hidden rounded-md border bg-card shadow-card transition-[border,background-color]",
                    isSelected && "border-primary bg-primary-muted/60"
                  )}
                >
                <button
                  type="button"
                  data-testid="queue-card"
                  data-queue-id={queue.id}
                  data-accepting-tokens={closed ? "false" : "true"}
                  className={cn(
                    "queue-card flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left outline-none hover:bg-secondary/40 focus-visible:ring-3 focus-visible:ring-ring/50",
                    isSelected && "bg-transparent"
                  )}
                  onClick={() => {
                    setSelectedQueueId(queue.id);
                    setJoinError("");
                  }}
                  aria-pressed={isSelected}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="font-heading text-title text-foreground">{queue.name}</span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      <span
                        data-testid={primaryTestId}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          closed && "bg-secondary text-text-secondary",
                          !closed && full && "bg-danger-soft text-danger-ink",
                          !closed && !full && paused && "bg-warning-soft text-warning-ink",
                          !closed && !full && !paused && "bg-primary-muted text-primary"
                        )}
                      >
                        {primaryLabel}
                      </span>
                      {(closed || full) && paused ? (
                        <span
                          data-testid="queue-state-paused"
                          className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-ink"
                        >
                          {t("state.paused")}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-sm text-text-muted">
                    {queue.venue?.name || t("common.venue")} · {t("queue.avgMinutes", { minutes: queue.averageServiceTime })}
                    {" · "}
                    <span data-testid="queue-occupancy">{occupancyLine}</span>
                  </span>
                  <span className="text-sm text-text-muted" data-testid="queue-now-serving">
                    {servingLine}
                  </span>
                  {queue.shorterEquivalent ? (
                    <span
                      className="mt-1 text-sm font-medium text-primary"
                      data-testid="shorter-equivalent"
                    >
                      {t("queues.shorterEquivalent", { name: queue.shorterEquivalent.name })}
                    </span>
                  ) : null}
                  {queue.quietHint?.label ? (
                    <span className="mt-1 text-sm text-text-secondary" data-testid="quiet-hint">
                      {t("queues.quietHint", { time: queue.quietHint.label })}
                    </span>
                  ) : null}
                  {activeMemberships.some((row) => row.queue?.id === queue.id) ? (
                    <span
                      data-testid="queue-in-line"
                      className="mt-1 text-sm font-medium text-primary"
                    >
                      {activeMemberships.find((row) => row.queue?.id === queue.id)?.tokenNumber
                        ? t("queue.inLineToken", {
                            token: activeMemberships.find((row) => row.queue?.id === queue.id).tokenNumber,
                          })
                        : t("queue.inLine")}
                    </span>
                  ) : null}
                  {describeTodayException(queue.serviceExceptions, new Date(), locale) ? (
                    <span data-testid="queue-holiday-hours" className="text-sm text-text-secondary">
                      {describeTodayException(queue.serviceExceptions, new Date(), locale)}
                    </span>
                  ) : null}
                  {closed && queue.reopenAt ? (
                    <span
                      data-testid="queue-reopen"
                      className="text-sm text-text-secondary"
                    >
                      {t("queue.reopens", { when: formatCampusDateTime(queue.reopenAt, locale) })}
                    </span>
                  ) : null}
                </button>
                {closed && !isAdmin ? (
                  <OpenWatchControls queue={queue} className="px-4 pb-3 pt-0" />
                ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {isAdmin ? (
            <>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => navigate("/admin/catalog")}
              data-testid="open-catalog"
              className="w-full sm:w-auto"
            >
              Manage catalog
            </Button>
            {canManageQueue(selected) ? (
            <Button
              size="lg"
              onClick={handleManage}
              data-testid="open-admin-console"
              className="w-full sm:w-auto"
            >
              Manage {selected.name}
            </Button>
            ) : null}
            </>
          ) : activeMemberships.some((row) => row.queue?.id === selected.id) ? (
            <Button
              size="lg"
              onClick={() => handleViewPlace(selected.id)}
              data-testid="view-place-in-line"
              className="w-full sm:w-auto"
            >
              {t("queue.viewPlace", { name: selected.name })}
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={handleJoin}
              disabled={joinBusy || selected.acceptingTokens === false || selected.full === true}
              data-testid="join-queue"
              className="w-full sm:w-auto"
            >
              {joinBusy
                ? t("queue.joining")
                : selected.acceptingTokens === false
                  ? selected.reopenAt
                    ? t("queue.closedReopens", {
                        name: selected.name,
                        when: formatCampusDateTime(selected.reopenAt, locale),
                      })
                    : t("queue.closed", { name: selected.name })
                  : selected.full === true
                    ? t("queue.full", { name: selected.name })
                    : t("queue.join", { name: selected.name })}
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
          {t("common.refresh")}
        </Button>
        {!isAdmin && !isGuest && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("/history")}
            data-testid="view-history"
          >
            {t("queues.viewHistory")}
          </Button>
        )}
      </div>
    </ShellContent>
  );
}
