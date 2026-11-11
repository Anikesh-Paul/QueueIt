import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { useApp } from "@/context/app-context";
import { ShellContent } from "@/components/shell/shell-content";
import { MotifIllustration } from "@/components/brand/motif-illustration";
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
 * Poster / deep-link landing — join a specific queue (or explain why not).
 * Guests land here without visiting the catalog first.
 */
export function JoinPage() {
  const { t, locale } = useI18n();
  const { queueId } = useParams();
  const navigate = useNavigate();
  const {
    token,
    guestCredential,
    isGuest,
    isAdmin,
    user,
    queues,
    queuesLoading,
    queuesError,
    loadQueues,
    joinBusy,
    joinError,
    setJoinError,
    join,
    openAdminConsole,
    activeMemberships,
    selectMembership,
  } = useApp();

  const validId = isQueueId(queueId || "");
  function canManageQueue(target) {
    if (!isAdmin) return false;
    return staffCanManageQueue(user, target);
  }

  useEffect(() => {
    if (!validId) return undefined;
    loadQueues(token || null, { guestCred: guestCredential || null });
    return undefined;
  }, [validId, token, guestCredential, loadQueues]);

  useEffect(() => {
    setJoinError("");
  }, [queueId, setJoinError]);

  const queue = validId ? queues.find((row) => row.id === queueId) : null;
  const membership = activeMemberships.find((row) => row.queue?.id === queueId);
  const closed = queue?.acceptingTokens === false;
  const occupancyLine = queue ? formatWaitingOccupancy({ ...queue, locale }) : "";
  const servingLine = queue ? formatCatalogServing({ ...queue, locale }) : "";
  const full = queue?.full === true;
  const paused = queue?.status === "paused";
  const primaryLabel = !queue ? null : closed ? t("state.closed") : full ? t("state.full") : paused ? t("state.paused") : t("state.open");

  async function handleJoin() {
    if (!validId || joinBusy) return;
    const ok = await join(queueId);
    if (ok) navigate("/status");
  }

  async function handleViewPlace() {
    await selectMembership(queueId);
    navigate("/status");
  }

  async function handleManage() {
    setJoinError("");
    await openAdminConsole(queueId);
    navigate(`/admin/queues/${queueId}`);
  }

  return (
    <ShellContent tier="student">
      <header className="mb-6">
        <h1
          data-testid="join-heading"
          className="font-heading text-headline leading-tight text-foreground"
        >
          {t("join.title")}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {t("join.intro")}
        </p>
      </header>

      {!validId ? (
        <div
          data-testid="join-invalid"
          className="rounded-md border border-border bg-card px-5 py-10 text-center shadow-card"
        >
          <MotifIllustration motif="serviceWindow" variant="error" dimmer className="mb-4" />
          <p className="font-display text-display font-semibold tracking-[-0.01em] text-foreground">
            {t("join.invalid")}
          </p>
          <p className="mt-1 text-sm text-text-secondary">{t("join.invalidHint")}</p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => navigate("/queues")}
            data-testid="join-back-to-queues"
          >
            {t("join.browse")}
          </Button>
        </div>
      ) : null}

      {validId && queuesLoading && !queue ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading queue">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-11 rounded-lg" />
        </div>
      ) : null}

      {validId && queuesError ? <Alert variant="destructive">{queuesError}</Alert> : null}

      {validId && !queuesLoading && !queuesError && !queue ? (
        <div
          data-testid="join-not-found"
          className="rounded-md border border-border bg-card px-5 py-10 text-center shadow-card"
        >
          <MotifIllustration motif="waitingHall" variant="empty" className="mb-4" />
          <p className="font-display text-display font-semibold tracking-[-0.01em] text-foreground">
            {queues.length === 0 ? t("queues.empty") : t("join.notFound")}
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {queues.length === 0
              ? t("join.emptyHint")
              : t("join.notFoundHint")}
          </p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => navigate("/queues")}
            data-testid="join-back-to-queues"
          >
            {t("join.browse")}
          </Button>
        </div>
      ) : null}

      {queue ? (
        <section
          data-testid="join-queue-card"
          data-queue-id={queue.id}
          className="rounded-md border border-border bg-card px-5 py-5 shadow-card"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2
                data-testid="join-queue-name"
                className="font-heading text-title text-foreground"
              >
                {queue.name}
              </h2>
              <p className="mt-0.5 text-sm text-text-muted">
                {queue.venue?.name || t("common.venue")} · {t("queue.avgMinutes", { minutes: queue.averageServiceTime })}
                {" · "}
                <span data-testid="queue-occupancy">{occupancyLine}</span>
              </p>
              <p className="mt-0.5 text-sm text-text-muted" data-testid="queue-now-serving">
                {servingLine}
              </p>
              {queue.shorterEquivalent ? (
                <p className="mt-2 text-sm font-medium text-primary" data-testid="shorter-equivalent">
                  <Link
                    to={joinPath(queue.shorterEquivalent.id)}
                    className="underline-offset-4 hover:underline"
                    data-testid="shorter-equivalent-link"
                  >
                    {t("queues.shorterEquivalent", { name: queue.shorterEquivalent.name })}
                  </Link>
                </p>
              ) : null}
              {queue.quietHint?.label ? (
                <p className="mt-2 text-sm text-text-secondary" data-testid="quiet-hint">
                  {t("queues.quietHint", { time: queue.quietHint.label })}
                </p>
              ) : null}
            </div>
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              <span
                data-testid={
                  closed
                    ? "queue-state-closed"
                    : full
                      ? "queue-state-full"
                      : paused
                        ? "queue-state-paused"
                        : "queue-state-open"
                }
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold",
                  closed && "bg-secondary text-text-secondary",
                  !closed && full && "bg-[#FEE2E2] text-[#991B1B]",
                  !closed && !full && paused && "bg-[#FEF3C7] text-[#92400E]",
                  !closed && !full && !paused && "bg-primary-muted text-primary"
                )}
              >
                {primaryLabel}
              </span>
              {(closed || full) && paused ? (
                <span
                  data-testid="queue-state-paused"
                  className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-xs font-semibold text-[#92400E]"
                >
                  {t("state.paused")}
                </span>
              ) : null}
            </span>
          </div>

          {membership ? (
            <p data-testid="queue-in-line" className="mt-3 text-sm font-medium text-primary">
              {membership.tokenNumber
                ? t("queue.inLineToken", { token: membership.tokenNumber })
                : t("queue.inLine")}
            </p>
          ) : null}

          {describeTodayException(queue.serviceExceptions, new Date(), locale) ? (
            <p data-testid="queue-holiday-hours" className="mt-3 text-sm text-text-secondary">
              {describeTodayException(queue.serviceExceptions, new Date(), locale)}
            </p>
          ) : null}

          {closed && !membership && !isAdmin ? (
            <p data-testid="join-closed-reason" className="mt-3 text-sm text-text-secondary">
              {t("join.closedReason")}
              {queue.reopenAt
                ? t("join.closedReopens", { when: formatCampusDateTime(queue.reopenAt, locale) })
                : t("join.closedLater")}
            </p>
          ) : closed && queue.reopenAt ? (
            <p data-testid="queue-reopen" className="mt-3 text-sm text-text-secondary">
              {t("queue.reopens", { when: formatCampusDateTime(queue.reopenAt, locale) })}
            </p>
          ) : null}

          {full && !closed && !membership && !isAdmin ? (
            <p data-testid="join-full-reason" className="mt-3 text-sm text-text-secondary">
              {t("join.fullReason", {
                occupancy: occupancyLine ? t("join.fullOccupancy", { occupancy: occupancyLine }) : "",
              })}
            </p>
          ) : null}

          {closed && !isAdmin ? (
            <OpenWatchControls queue={queue} className="mt-3" />
          ) : null}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            {canManageQueue(queue) ? (
              <Button
                size="lg"
                onClick={handleManage}
                data-testid="open-admin-console"
                className="w-full sm:w-auto"
              >
                Manage {queue.name}
              </Button>
            ) : membership ? (
              <Button
                size="lg"
                onClick={handleViewPlace}
                data-testid="view-place-in-line"
                className="w-full sm:w-auto"
              >
                {t("queue.viewPlace", { name: queue.name })}
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={handleJoin}
                disabled={joinBusy || closed || full}
                data-testid="join-queue"
                className="w-full sm:w-auto"
              >
                {joinBusy
                  ? "Joining…"
                  : closed
                    ? `${queue.name} is closed`
                    : full
                      ? `${queue.name} is full`
                      : `Join ${queue.name}`}
              </Button>
            )}
            <Button
              variant="secondary"
              size="lg"
              onClick={() => navigate("/queues")}
              data-testid="join-browse-queues"
              className="w-full sm:w-auto"
            >
              {t("join.browse")}
            </Button>
          </div>
        </section>
      ) : null}

      {joinError ? <Alert variant="destructive" className="mt-4">{joinError}</Alert> : null}

      {isGuest && validId ? (
        <p className="mt-6 text-sm text-text-secondary">
          {t("join.haveAccount")}{" "}
          <Link
            to="/login"
            state={{ from: joinPath(queueId) }}
            className="font-medium text-primary underline-offset-4 hover:underline"
            data-testid="join-login-link"
          >
            {t("auth.login")}
          </Link>{" "}
          {t("join.keepPlace")}
        </p>
      ) : null}
    </ShellContent>
  );
}
