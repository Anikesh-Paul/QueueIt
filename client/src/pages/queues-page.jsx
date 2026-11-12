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
import { FeedbackPrompt } from "@/components/feedback/feedback-prompt";
import { formatCampusDateTime } from "@/lib/campus-time";
import { describeTodayException } from "@/lib/service-exceptions";
import { formatWaitingOccupancy } from "@/lib/waiting-occupancy";
import { formatCatalogServing } from "@/lib/now-serving";
import { isQueueId, joinPath } from "@/lib/join-link";
import { cn } from "@/lib/utils";
import { catalogWaitLabel } from "@/lib/wait-estimate";
import { useI18n } from "@/context/i18n-context";
import { staffCanManageQueue } from "@/lib/staff-access";
import { OpenWatchControls } from "@/components/status/open-watch-controls";
import { fetchMyAppointments } from "@/api";
import { formatBookingWhen } from "@/lib/appointments";
import { NoticeList } from "@/components/notices/notice-list";
import { useNotices } from "@/hooks/use-notices";
import { useOrganizations } from "@/hooks/use-organizations";
import { noticesForOrg, pickOrg, queuesForOrg, readOrgChoice, writeOrgChoice } from "@/lib/organizations";

/** Segmented picker shown only when there's more than one organization. */
function OrgPicker({ orgs, active, onPick, label }) {
  function onKeyDown(event) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const i = orgs.findIndex((o) => o.id === active?.id);
    const next = orgs[(i + step + orgs.length) % orgs.length];
    onPick(next);
    const buttons = event.currentTarget.querySelectorAll("[role=radio]");
    buttons[(i + step + orgs.length) % orgs.length]?.focus();
  }
  return (
    <div className="mb-5 -mx-1 overflow-x-auto px-1" data-testid="org-picker">
      <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="inline-flex gap-1 rounded-lg border border-border bg-card p-1 shadow-card">
        {orgs.map((org) => {
          const on = org.id === active?.id;
          return (
            <button
              key={org.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onPick(org)}
              data-testid="org-option"
              data-slug={org.slug}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-primary text-primary-foreground" : "text-text-secondary hover:bg-secondary hover:text-foreground"
              )}
            >
              {org.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Label each notice with the line or venue it's about, using catalog names. */
function withAudience(notices, queues) {
  const queueNames = new Map((queues || []).map((q) => [q.id, q.name]));
  const venueNames = new Map((queues || []).filter((q) => q.venue?.id).map((q) => [q.venue.id, q.venue.name]));
  return notices.map((n) => ({
    ...n,
    audience: n.scope === "queue" ? queueNames.get(n.queueId) : n.scope === "venue" ? venueNames.get(n.venueId) : null,
  }));
}

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
    queues: allQueues,
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
  const allNotices = useNotices(null);
  const orgs = useOrganizations();
  const [searchParams, setSearchParams] = useSearchParams();
  const [savedOrg, setSavedOrg] = useState(readOrgChoice);
  const activeOrg = pickOrg(orgs, { linkSlug: searchParams.get("org") || "", savedSlug: savedOrg });
  const queues = queuesForOrg(allQueues, activeOrg);
  const notices = noticesForOrg(allNotices, activeOrg, queues);
  const linkedOrg = activeOrg && searchParams.get("org") === activeOrg.slug ? activeOrg.slug : "";
  useEffect(() => {
    // A shared ?org= link becomes this device's choice for next time.
    if (linkedOrg) writeOrgChoice(linkedOrg);
  }, [linkedOrg]);
  function chooseOrg(org) {
    writeOrgChoice(org.slug);
    setSavedOrg(org.slug);
    if (searchParams.get("org")) {
      const next = new URLSearchParams(searchParams);
      next.delete("org");
      setSearchParams(next, { replace: true });
    }
  }
  const navigate = useNavigate();
  function canManageQueue(queue) {
    if (!isAdmin) return false;
    return staffCanManageQueue(user, queue);
  }
  const [myBookings, setMyBookings] = useState([]);

  useEffect(() => {
    if (!token || isAdmin) {
      setMyBookings([]);
      return;
    }
    let cancelled = false;
    fetchMyAppointments(token)
      .then((data) => {
        if (!cancelled) setMyBookings(data.appointments || []);
      })
      .catch(() => {
        if (!cancelled) setMyBookings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, isAdmin]);

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

      {activeOrg ? <OrgPicker orgs={orgs} active={activeOrg} onPick={chooseOrg} label={t("org.pickerLabel")} /> : null}

      <FeedbackPrompt />

      <NoticeList notices={withAudience(notices, queues)} showAudience collapseAfter={2} className="mb-5" />

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
                    {queue.venue?.name || t("common.venue")} ·{" "}
                    {catalogWaitLabel(queue.waitEstimate, locale) ? (
                      <span data-testid="queue-wait-estimate" className="font-medium text-text-secondary">
                        {catalogWaitLabel(queue.waitEstimate, locale)}
                      </span>
                    ) : (
                      t("queue.avgMinutes", { minutes: queue.averageServiceTime })
                    )}
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
                  {myBookings
                    .filter((row) => row.queueId === queue.id && row.status === "booked")
                    .slice(0, 1)
                    .map((mine) => (
                      <span key={mine.id} data-testid="queue-my-booking" className="mt-1 text-sm font-medium text-info-ink">
                        {t("book.bookedLine", { time: formatBookingWhen(mine.slotStart, locale) })}
                      </span>
                    ))}
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
            <>
            {selected.appointments?.enabled ? (
              <Button
                variant="secondary"
                size="lg"
                onClick={() => navigate(`/book/${selected.id}`)}
                data-testid="book-time"
                className="w-full sm:w-auto"
              >
                {t("book.cta")}
              </Button>
            ) : null}
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
            </>
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
