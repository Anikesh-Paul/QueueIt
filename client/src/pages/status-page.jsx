import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
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
import { PageToolbar } from "@/components/shell/page-toolbar";
import { ShellContent } from "@/components/shell/shell-content";
import { RealtimeIndicator } from "@/components/realtime-indicator";
import { cn } from "@/lib/utils";
import { confidenceLabel, estimateBasisLine, formatWaitRange } from "@/lib/wait-estimate";
import {
  formatCampusClockTime,
  formatCampusDateTime,
  formatPaceLine,
  presentLiveEta,
} from "@/lib/campus-time";
import { resolveArrivalPass } from "@/lib/arrival-pass";
import { nearFrontBannerCopy, NEAR_FRONT_POSITION_LIMIT } from "@/lib/queue-notifications";
import { statusConnectionPresentation } from "@/lib/status-connection";
import { presentServingBoard } from "@/lib/now-serving";
import { NotifyControls } from "@/components/status/notify-controls";
import { useI18n } from "@/context/i18n-context";
import { acknowledgeArrival, rejoinQueue, requestPriority, setTravelMinutes } from "@/api";
import { LeaveNowBanner, LeaveTimeCard } from "@/components/status/leave-time-card";
import { NoticeList } from "@/components/notices/notice-list";
import { useNotices } from "@/hooks/use-notices";
import { liveLeave } from "@/lib/leave-alert";
import { WifiOff } from "lucide-react";
import { actionErrorMessage, formatAsOf } from "@/lib/offline";

/**
 * Live status — signature student surface.
 * Wide (md+): token + metrics | arrival pass + Leave.
 * Phone: hero → metrics → pass → Leave.
 * No motif wallpaper; forest edge + mist on token hero; arrival stub + terracotta.
 */
export function StatusPage() {
  const { t, locale } = useI18n();
  const {
    token,
    guestCredential,
    user,
    inQueue,
    liveStatus,
    statusQueueId,
    statusQueueName,
    statusLastUpdatedAt,
    statusUpdating,
    statusOffline,
    statusError,
    refreshStatus,
    leave,
    leaveBusy,
    leaveError,
    realtimeConnected,
    activeMemberships,
    selectMembership,
    adoptMembership,
  } = useAppStatus();
  const notices = useNotices(statusQueueId, { enabled: Boolean(statusQueueId) });
  const navigate = useNavigate();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [browserOffline, setBrowserOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false
  );
  /** Pin ETA as-of while Paused so polls/wall clock cannot slide the primary. */
  const [frozenEtaAsOfMs, setFrozenEtaAsOfMs] = useState(null);
  const [hereBusy, setHereBusy] = useState(false);
  const [hereError, setHereError] = useState("");
  const [rejoinBusy, setRejoinBusy] = useState(false);
  const [rejoinError, setRejoinError] = useState("");
  const [priorityBusy, setPriorityBusy] = useState(false);
  const [priorityError, setPriorityError] = useState("");
  const [priorityReason, setPriorityReason] = useState("accessibility");
  const [travelBusy, setTravelBusy] = useState(false);
  const [travelError, setTravelError] = useState("");

  useEffect(() => {
    if (!inQueue) navigate("/queues", { replace: true });
  }, [inQueue, navigate]);

  useEffect(() => {
    if (!inQueue || statusLastUpdatedAt == null) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [inQueue, statusLastUpdatedAt]);

  useEffect(() => {
    function goOnline() {
      setBrowserOffline(false);
    }
    function goOffline() {
      setBrowserOffline(true);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const paused = liveStatus?.queue?.status === "paused";

  useEffect(() => {
    if (!paused) {
      setFrozenEtaAsOfMs(null);
      return;
    }
    setFrozenEtaAsOfMs((prev) => prev ?? statusLastUpdatedAt ?? Date.now());
  }, [paused, statusLastUpdatedAt]);


  useEffect(() => {
    if (liveStatus?.status !== "skipped" || !liveStatus.recoverUntil) return undefined;
    const ms = new Date(liveStatus.recoverUntil).getTime() - Date.now();
    const id = setTimeout(() => {
      if (statusQueueId) refreshStatus?.(token || null, statusQueueId, { guestCred: guestCredential, silent: true });
    }, Math.max(0, ms) + 50);
    return () => clearTimeout(id);
  }, [liveStatus, statusQueueId, token, guestCredential, refreshStatus]);

  if (!inQueue || !liveStatus) return null;

  const closed = liveStatus.queue?.acceptingTokens === false;
  const offline = Boolean(statusOffline || browserOffline);
  const connection = statusConnectionPresentation({
    offline,
    realtimeConnected,
    statusLastUpdatedAt,
    nowMs,
    locale,
  });
  const ageLabel = connection.ageLabel;
  const queueTitle = liveStatus.queue?.name || statusQueueName;
  // Banner suppressed while paused: position is near the front but the line is
  // frozen, so "approach the counter" would be dishonest. Closed drain may still approach.
  const isCalled = liveStatus.status === "serving";
  const isMissed = liveStatus.status === "skipped";
  const recoverUntilMs = liveStatus.recoverUntil ? new Date(liveStatus.recoverUntil).getTime() : null;
  const recoverSecondsLeft =
    isMissed && recoverUntilMs != null
      ? Math.max(0, Math.ceil((recoverUntilMs - nowMs) / 1000))
      : null;
  const canRecover = Boolean(isMissed && liveStatus.canRecover && recoverSecondsLeft > 0);
  const nearFront =
    !isCalled &&
    !isMissed &&
    !paused &&
    Number.isInteger(liveStatus.position) &&
    liveStatus.position <= NEAR_FRONT_POSITION_LIMIT;

  const leaveTime = isCalled || isMissed ? null : liveLeave(liveStatus.leave, nowMs);
  const leaveNow =
    leaveTime?.state === "now" && !paused && Number.isInteger(liveStatus.position) && liveStatus.position > 1;

  const paceLine = isCalled || isMissed
    ? null
    : formatPaceLine(
        liveStatus.position,
        liveStatus.etaServiceTime ?? liveStatus.averageServiceTime,
        locale
      );
  // Live: wall clock (remaining wait). Paused: first pinned snapshot for this pause.
  const etaAsOfMs = paused
    ? (frozenEtaAsOfMs ?? statusLastUpdatedAt ?? nowMs)
    : nowMs;
  const etaPresented = presentLiveEta({
    etaMinutes: liveStatus.etaMinutes,
    asOfMs: etaAsOfMs,
    paused,
    locale,
  });
  const showEstimate = !isCalled && !isMissed && !paused;
  const etaRangeText = showEstimate ? formatWaitRange(liveStatus.etaRange, locale) : null;
  const basisLine = showEstimate ? estimateBasisLine(liveStatus.etaBasis, { locale, nowMs }) : null;
  const confidence = showEstimate ? confidenceLabel(liveStatus.etaConfidence, locale) : null;
  const sessionEndsAt = liveStatus.queue?.sessionEndsAt;
  const servingBoard = presentServingBoard(liveStatus.counters, liveStatus.nowServing, locale);

  async function handleLeave() {
    const ok = await leave();
    if (ok) navigate("/queues");
  }

  async function handleTravelChange(minutes) {
    if (travelBusy || !statusQueueId) return;
    setTravelBusy(true);
    setTravelError("");
    try {
      const data = await setTravelMinutes(token, statusQueueId, minutes, guestCredential);
      adoptMembership?.(data);
    } catch {
      setTravelError(t("leave.saveFailed"));
    } finally {
      setTravelBusy(false);
    }
  }

  async function handleHere() {
    if (hereBusy || !statusQueueId) return;
    setHereBusy(true);
    setHereError("");
    try {
      await acknowledgeArrival(token, statusQueueId, guestCredential);
      await refreshStatus?.();
    } catch (err) {
      setHereError(actionErrorMessage(err, "generic", locale, t("status.checkInFailed")));
    } finally {
      setHereBusy(false);
    }
  }

  async function handleRequestPriority() {
    if (priorityBusy || !statusQueueId) return;
    setPriorityBusy(true);
    setPriorityError("");
    try {
      await requestPriority(token, statusQueueId, priorityReason, guestCredential);
      await refreshStatus?.();
    } catch (err) {
      setPriorityError(actionErrorMessage(err, "generic", locale, t("status.priorityRequestFailed")));
    } finally {
      setPriorityBusy(false);
    }
  }

  async function handleRejoin() {
    if (rejoinBusy || !statusQueueId) return;
    setRejoinBusy(true);
    setRejoinError("");
    try {
      await rejoinQueue(token, statusQueueId, guestCredential);
      await refreshStatus?.();
    } catch (err) {
      setRejoinError(actionErrorMessage(err, "join", locale, t("status.rejoinFailed")));
    } finally {
      setRejoinBusy(false);
    }
  }

  return (
    <>
      <PageToolbar
        tier="student"
        title={<span data-testid="status-queue-name">{queueTitle}</span>}
        meta={
          <>
            <span className="shrink-0" data-testid="status-connection-label">
              {connection.metaLabel}
            </span>
            <RealtimeIndicator mode={connection.indicator} testId="realtime-status" />
            {ageLabel ? (
              <span
                data-testid="status-age"
                className="inline-block min-w-[4.75rem] shrink-0 tabular-nums tracking-tight text-text-muted"
              >
                · {ageLabel}
              </span>
            ) : null}
            {statusUpdating ? (
              <span aria-live="polite" className="shrink-0">
                · Updating…
              </span>
            ) : null}
          </>
        }
        status={
          <span className="flex flex-wrap items-center gap-1.5">
            {closed ? (
              <span
                aria-live="polite"
                data-testid="queue-closed"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-text-secondary"
              >
                <span className="size-1.5 rounded-full bg-text-muted" />
                Closed for new tokens
              </span>
            ) : null}
            {paused ? (
              <span
                aria-live="polite"
                data-testid="queue-paused"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning-ink"
              >
                <span className="size-1.5 rounded-full bg-attention" />
                Paused
              </span>
            ) : offline ? (
              <span
                data-testid="queue-offline-badge"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-text-secondary"
              >
                <span className="size-1.5 rounded-full bg-text-muted" />
                Offline
              </span>
            ) : !closed && connection.showLiveBadge ? (
              <span
                data-testid="queue-live"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary-muted px-2.5 py-1 text-xs font-semibold text-primary"
              >
                <span className="size-1.5 rounded-full bg-primary" />
                {t("status.live")}
              </span>
            ) : (
              <span
                data-testid="queue-live"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary-muted px-2.5 py-1 text-xs font-semibold text-primary"
              >
                <span className="size-1.5 rounded-full bg-primary" />
                {t("status.stillInLine")}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                refreshStatus(token || null, statusQueueId, {
                  guestCred: guestCredential || null,
                })
              }
              disabled={statusUpdating}
              data-testid="status-refresh"
            >
              {t("common.refresh")}
            </Button>
            {user?.role !== "admin" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("/history")}
                data-testid="status-view-history"
              >
                {t("status.viewHistory")}
              </Button>
            )}
          </>
        }
      />

      <ShellContent tier="student">
        {offline ? (
          <div
            data-testid="status-offline"
            role="status"
            aria-live="polite"
            className="mb-4 flex items-start gap-3 rounded-lg border border-warning-line bg-warning-soft px-3.5 py-3 text-sm text-warning-ink"
          >
            <WifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">{t("status.offlineTitle")}</p>
              <p>{t("status.offlineBanner")}</p>
              {formatAsOf(statusLastUpdatedAt, locale) ? (
                <p data-testid="status-offline-as-of" className="mt-0.5 font-medium">
                  {t("status.offlineAsOf", { time: formatAsOf(statusLastUpdatedAt, locale) })}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <header className="mb-4">
          <h1
            data-testid="status-heading"
            className="font-display text-display font-semibold leading-tight tracking-[-0.01em] text-foreground"
          >
            {t("status.title")}
          </h1>
          {activeMemberships.length > 1 ? (
            <div
              className="mt-3 flex flex-wrap items-center gap-2"
              data-testid="status-membership-switcher"
              role="tablist"
              aria-label={t("status.yourLines")}
            >
              {activeMemberships.map((row) => {
                const id = row.queue?.id;
                const name = row.queue?.name || t("common.queue");
                const selected = id === statusQueueId;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    data-testid="status-queue-tab"
                    onClick={() => id && selectMembership(id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-text-secondary hover:bg-secondary/80"
                    )}
                  >
                    {name}
                    {row.tokenNumber != null ? ` · #${row.tokenNumber}` : ""}
                  </button>
                );
              })}
            </div>
          ) : null}
        </header>

        {closed && (
          <Alert
            className="mb-4"
            data-testid="closed-drain-notice"
            role="status"
          >
            {t("status.closedDrain")}
            {liveStatus.queue?.reopenAt ? (
              <span data-testid="status-reopen" className="mt-1 block">
                {t("status.reopen", { when: formatCampusDateTime(liveStatus.queue.reopenAt, locale) })}
              </span>
            ) : null}
          </Alert>
        )}

        {!closed && sessionEndsAt ? (
          <p
            className="mb-4 text-sm text-text-secondary"
            data-testid="accepting-until"
            role="status"
          >
            {t("status.acceptingUntil", { when: formatCampusDateTime(sessionEndsAt, locale) })}
          </p>
        ) : null}

        {isMissed && (
          <div className="mb-4">
            <MissedTurnBanner
              t={t}
              canRecover={canRecover}
              secondsLeft={recoverSecondsLeft}
              busy={rejoinBusy}
              onRejoin={handleRejoin}
              reason={liveStatus.missedReason}
              graceMinutes={liveStatus.missedGraceMinutes}
              noShows={liveStatus.noShows}
              onJoinAgain={() => navigate("/queues")}
            />
          </div>
        )}

        {isCalled && (
          <div className="mb-4">
            <CalledBanner
              t={t}
              locale={locale}
              remainingSeconds={
                liveStatus.servingTimerFrozen
                  ? liveStatus.servingRemainingSeconds
                  : liveStatus.servingDeadlineAt
                    ? Math.max(
                        0,
                        Math.ceil((new Date(liveStatus.servingDeadlineAt).getTime() - nowMs) / 1000)
                      )
                    : liveStatus.servingRemainingSeconds
              }
              frozen={Boolean(liveStatus.servingTimerFrozen)}
              counterName={liveStatus.servingCounterName}
              here={Boolean(liveStatus.here)}
              hereBusy={hereBusy}
              onHere={handleHere}
            />
          </div>
        )}

        <NoticeList notices={notices} collapseAfter={1} className="mb-4" />

        {leaveNow ? (
          <div className="mb-4">
            <LeaveNowBanner
              etaMinutes={liveStatus.etaMinutes}
              travelMinutes={liveStatus.travelMinutes}
              locale={locale}
            />
          </div>
        ) : nearFront ? (
          <div className="mb-4">
            <NearFrontBanner position={liveStatus.position} locale={locale} />
          </div>
        ) : null}

        {!isMissed && (
          <PriorityBanner
            t={t}
            status={liveStatus.status}
            priority={Boolean(liveStatus.priority)}
            requestStatus={liveStatus.priorityRequestStatus}
            reason={priorityReason}
            onReason={setPriorityReason}
            busy={priorityBusy}
            onRequest={handleRequestPriority}
          />
        )}

        {/*
          Signature composition:
          md+: token+metrics | pass+Leave
          phone: hero → metrics → pass → Leave, then compact notifications.
          Urgent banners (called / offline) stay above the token.
        */}
        <div
          data-testid="status-layout"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start md:gap-5"
        >
          <section data-testid="status-metrics" className="flex flex-col gap-3">
            <StatusMetric
              label={t("status.token")}
              value={liveStatus.tokenNumber}
              hero
              testId="token-number"
            />
            {liveStatus.appointmentAt ? (
              <p className="text-sm font-medium text-info-ink" data-testid="status-booked-for">
                {t("book.bookedFor", { time: formatCampusClockTime(liveStatus.appointmentAt, locale) })}
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-stretch">
              <StatusMetric label={t("status.position")} value={isCalled ? t("status.called") : isMissed ? "—" : liveStatus.position} testId="position" />
              <StatusMetric
                label={t("status.eta")}
                value={
                  <span
                    className="flex flex-col items-start gap-0.5"
                    data-eta-mode={etaPresented.mode}
                  >
                    <span data-testid="eta-clock" className="leading-none">
                      {isCalled || isMissed ? "—" : etaPresented.primary}
                    </span>
                    {!isCalled && !isMissed && etaPresented.secondary ? (
                      <span
                        data-testid="eta-minutes"
                        className="text-sm font-medium tracking-normal text-text-muted"
                      >
                        {etaRangeText ?? etaPresented.secondary}
                      </span>
                    ) : paused ? (
                      <span
                        data-testid="eta-paused"
                        className="text-sm font-medium tracking-normal text-text-muted"
                      >
                        Paused
                      </span>
                    ) : null}
                  </span>
                }
                testId="eta"
              />
              <StatusMetric
                label={servingBoard.label}
                value={
                  servingBoard.multi ? (
                    <ul className="flex flex-col gap-1 text-left" data-testid="now-serving-counters">
                      {servingBoard.rows.map((row) => (
                        <li
                          key={row.id}
                          className="flex items-baseline justify-between gap-2 text-sm font-medium"
                          data-testid="now-serving-counter"
                        >
                          <span className="truncate font-sans text-xs font-semibold uppercase tracking-wide text-text-muted">
                            {row.name}
                          </span>
                          <span className="font-metric tabular-nums">
                            {row.value}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    servingBoard.value
                  )
                }
                testId="now-serving"
              />
            </div>
            {paceLine ? (
              <p
                data-testid="status-pace"
                className="text-sm text-text-secondary"
              >
                {paceLine}
              </p>
            ) : null}
            {basisLine ? (
              <p
                data-testid="status-estimate-basis"
                data-confidence={liveStatus.etaConfidence || undefined}
                className="-mt-1.5 text-sm text-text-muted"
              >
                {confidence ? <span className="font-medium text-text-secondary">{confidence}. </span> : null}
                {basisLine}
              </p>
            ) : null}
            {!isCalled && !isMissed && liveStatus.countersTotal > 1 && liveStatus.countersOpen < liveStatus.countersTotal ? (
              <p data-testid="status-counters-open" className="-mt-1 text-sm text-text-secondary">
                {liveStatus.countersOpen === 0
                  ? t("status.countersNoneOpen")
                  : t("status.countersOpen", { open: liveStatus.countersOpen, total: liveStatus.countersTotal })}
              </p>
            ) : null}
            <LeaveTimeCard
              leave={leaveTime}
              etaMinutes={liveStatus.etaMinutes}
              travelMinutes={liveStatus.travelMinutes}
              busy={travelBusy}
              error={travelError}
              onTravelChange={handleTravelChange}
              locale={locale}
              t={t}
            />
          </section>

          {isMissed ? null : (
          <section data-testid="status-pass-column" className="flex flex-col gap-4">
            <ArrivalPass
              queueName={queueTitle}
              queueId={statusQueueId}
              tokenNumber={liveStatus.tokenNumber}
              arrivalPass={liveStatus.arrivalPass}
              t={t}
            />
            <LeaveControl leaveBusy={leaveBusy} onLeave={handleLeave} t={t} />
          </section>
          )}
        </div>

        <div className="mt-5" data-testid="status-notify-slot">
          <NotifyControls called={isCalled} />
        </div>

        {(statusError || leaveError || hereError || rejoinError || priorityError) && (
          <div className="mt-4 space-y-2">
            {statusError && <Alert variant="destructive">{statusError}</Alert>}
            {leaveError && <Alert variant="destructive">{leaveError}</Alert>}
            {hereError && <Alert variant="destructive">{hereError}</Alert>}
            {rejoinError && <Alert variant="destructive">{rejoinError}</Alert>}
            {priorityError && <Alert variant="destructive">{priorityError}</Alert>}
          </div>
        )}
      </ShellContent>
    </>
  );
}

function LeaveControl({ leaveBusy, onLeave, t }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="lg"
          disabled={leaveBusy}
          data-testid="leave-queue"
          className="w-full border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
        >
          {leaveBusy ? t("status.leaving") : t("status.leave")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="leave-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("status.leaveTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("status.leaveBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel data-testid="leave-keep">{t("status.leaveKeep")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructiveSolid"
            data-testid="leave-confirm"
            onClick={onLeave}
          >
            {t("status.leave")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatCallRemaining(seconds, t) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  const total = Math.max(0, Math.ceil(Number(seconds)));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes <= 0) return t("status.secsLeft", { secs });
  return t("status.clockLeft", { clock: `${minutes}:${String(secs).padStart(2, "0")}` });
}


function formatRejoinClock(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function missedReasonCopy(t, reason, graceMinutes) {
  if (reason === "staff") return t("status.missedStaff");
  if (reason === "no-show") {
    return graceMinutes
      ? t("status.missedNoShow", { minutes: graceMinutes })
      : t("status.missedNoShowGeneric");
  }
  return null;
}

function MissedTurnBanner({ t, canRecover, secondsLeft, busy, onRejoin, reason, graceMinutes, noShows, onJoinAgain }) {
  const why = missedReasonCopy(t, reason, graceMinutes);
  const count = Number(noShows?.count) || 0;
  const limit = Number(noShows?.threshold) || 0;
  const days = noShows?.windowDays || 30;
  return (
    <div
      className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
      data-testid="missed-turn-banner"
      data-reason={reason || "unknown"}
      role="status"
    >
      <p className="font-heading text-sm font-semibold text-foreground">{t("status.missedTitle")}</p>
      {why ? (
        <p className="mt-1 text-sm text-text-secondary" data-testid="missed-turn-reason">
          {why}
        </p>
      ) : null}
      {canRecover ? (
        <>
          <p className="mt-1 text-sm text-text-secondary">{t("status.rejoinHint")}</p>
          <Button
            type="button"
            className="mt-3"
            onClick={onRejoin}
            disabled={busy}
            data-testid="rejoin-queue"
          >
            {busy
              ? t("status.rejoining")
              : t("status.rejoin", { clock: formatRejoinClock(secondsLeft) })}
          </Button>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-text-secondary">{t("status.rejoinClosed")}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={onJoinAgain}
            data-testid="missed-join-again"
          >
            {t("status.joinAgain")}
          </Button>
        </>
      )}
      {count > 0 && limit > 0 ? (
        <p className="mt-3 text-xs text-text-muted" data-testid="missed-turn-count">
          {count >= limit
            ? t("status.noShowFlagged", { count, days })
            : t("status.noShowCount", { count, days, limit })}
        </p>
      ) : null}
    </div>
  );
}

function CalledBanner({ remainingSeconds, frozen, counterName, here = false, hereBusy = false, onHere, t }) {
  const remaining = formatCallRemaining(remainingSeconds, t);
  const place = counterName ? counterName : t("status.theCounter");
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="called-banner"
      className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary-muted px-4 py-3"
    >
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-heading text-sm font-semibold text-foreground">
          {counterName ? t("status.calledAt", { counter: counterName }) : t("status.calledGeneric")}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-text-secondary" data-testid="called-remaining">
          {here
            ? t("status.hereConfirmedCopy", { place })
            : frozen
              ? t("status.timerPaused")
              : remaining
                ? t("status.arriveIn", { remaining, place })
                : t("status.pleaseCome", { place })}
        </p>
        {here ? (
          <p className="mt-2 text-sm font-medium text-primary" data-testid="here-confirmed">
            {t("status.hereConfirmed")}
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={hereBusy}
            data-testid="im-here"
            onClick={onHere}
          >
            {hereBusy ? t("status.checkingIn") : t("status.imHere")}
          </Button>
        )}
      </div>
    </div>
  );
}

function NearFrontBanner({ position, locale = "en" }) {
  const { title, body, kind } = nearFrontBannerCopy({ position, locale });
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="near-front-banner"
      data-near-front={kind}
      className="flex items-start gap-2.5 rounded-lg border border-warning-line bg-warning-soft px-4 py-3"
    >
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-attention" aria-hidden="true" />
      <div>
        <p className="font-heading text-sm font-semibold text-warning-ink">
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-warning-ink">
          {body}
        </p>
      </div>
    </div>
  );
}

/**
 * Arrival pass — QR + token hierarchy; stub corner + terracotta edge (signature).
 * Prefers the signed payload from live status.
 */
function ArrivalPass({ queueName, queueId, tokenNumber, arrivalPass, t }) {
  const payload = resolveArrivalPass({ arrivalPass, queueId, tokenNumber });
  return (
    <section
      data-testid="arrival-pass"
      data-payload={payload}
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card",
        /* Terracotta 2px accent on the left edge only + subtle stub corner */
        "border-l-[2px] border-l-warning"
      )}
    >
      {/* Subtle CSS stub / dog-ear at top-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 size-0 border-b-[18px] border-l-[18px] border-b-transparent border-l-secondary"
        style={{
          filter: "drop-shadow(-1px 1px 0 rgb(26 26 24 / 8%))",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 size-0 border-r-[18px] border-t-[18px] border-r-background border-t-background"
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <div
          className="shrink-0 self-center rounded-lg border border-border bg-white p-3 shadow-card"
          data-testid="arrival-qr"
        >
          <QRCodeSVG
            value={payload}
            size={128}
            level="M"
            marginSize={0}
            className="block h-28 w-28"
            role="img"
            aria-label={t("pass.qrLabel", { token: tokenNumber })}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-headline font-semibold tracking-[-0.01em] text-foreground">
            {t("pass.title")}
          </p>
          <p className="mt-2 text-sm text-foreground">
            {t("pass.tokenQueue")}{" "}
            <span
              className="font-metric text-base font-bold tabular-nums text-primary"
              data-testid="arrival-token"
            >
              {tokenNumber}
            </span>
            <span className="text-text-muted"> · {queueName}</span>
          </p>
          <p className="mt-2 text-xs leading-5 text-text-secondary" data-testid="arrival-disclaimer">
            {t("pass.disclaimer")}
          </p>
        </div>
      </div>
    </section>
  );
}

function StatusMetric({ label, value, hero = false, testId }) {
  const valueEl = (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex items-baseline font-metric text-metric tabular-nums text-foreground",
        hero &&
          "text-[2.75rem] font-bold leading-[1.05] tracking-[-0.02em] text-foreground sm:text-[3rem]"
      )}
    >
      {value}
    </span>
  );
  const labelEl = (
    <span
      className={cn(
        "text-label uppercase tracking-wide text-text-muted",
        hero && "font-medium normal-case tracking-normal text-text-muted"
      )}
    >
      {label}
    </span>
  );
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-1 rounded-md border border-border bg-secondary px-4 py-3",
        hero &&
          /* 14px radius; number leads, Token is a quiet label, no pastel wash. */
          "rounded-xl min-h-[6.5rem] justify-center gap-1 border-l-4 border-l-primary border-border bg-card px-6 py-5 sm:min-h-[7rem]"
      )}
    >
      {hero ? (
        <>
          {valueEl}
          {labelEl}
        </>
      ) : (
        <>
          {labelEl}
          {valueEl}
        </>
      )}
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


function PriorityBanner({ t, status, priority, requestStatus, reason, onReason, busy, onRequest }) {
  if (priority) {
    return (
      <div className="mb-4" data-testid="priority-banner">
        <p className="rounded-xl border border-primary/30 bg-primary-muted px-4 py-3 text-sm font-medium text-foreground">
          {t("status.priorityApproved")}
        </p>
      </div>
    );
  }
  if (status !== "waiting") return null;
  if (requestStatus === "pending") {
    return (
      <div className="mb-4" data-testid="priority-banner">
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground">
          {t("status.priorityRequested")}
        </p>
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-xl border border-border bg-card px-4 py-3" data-testid="priority-banner">
      {requestStatus === "rejected" ? (
        <p className="mb-2 text-sm text-text-secondary">{t("status.priorityRejected")}</p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium text-text-secondary">
          {t("status.priorityReason")}
          <select
            value={reason}
            onChange={(event) => onReason(event.target.value)}
            disabled={busy}
            data-testid="priority-reason"
            className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="accessibility">{t("status.priorityAccessibility")}</option>
            <option value="pregnancy">{t("status.priorityPregnancy")}</option>
            <option value="medical">{t("status.priorityMedical")}</option>
            <option value="other">{t("status.priorityOther")}</option>
          </select>
        </label>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onRequest}
          data-testid="request-priority"
        >
          {busy ? t("status.requestingPriority") : t("status.requestPriority")}
        </Button>
      </div>
    </div>
  );
}
