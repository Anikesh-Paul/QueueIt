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
import {
  formatCampusDateTime,
  formatPaceLine,
  presentLiveEta,
} from "@/lib/campus-time";
import { resolveArrivalPass } from "@/lib/arrival-pass";
import { nearFrontBannerCopy, NEAR_FRONT_POSITION_LIMIT } from "@/lib/queue-notifications";
import { statusConnectionPresentation } from "@/lib/status-connection";
import { presentServingBoard } from "@/lib/now-serving";
import { NotifyControls } from "@/components/status/notify-controls";

/**
 * Live status — signature student surface.
 * Wide (md+): token + metrics | arrival pass + Leave.
 * Phone: hero → metrics → pass → Leave.
 * No motif wallpaper; forest edge + mist on token hero; arrival stub + terracotta.
 */
export function StatusPage() {
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
  } = useAppStatus();
  const navigate = useNavigate();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [browserOffline, setBrowserOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false
  );
  /** Pin ETA as-of while Paused so polls/wall clock cannot slide the primary. */
  const [frozenEtaAsOfMs, setFrozenEtaAsOfMs] = useState(null);

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

  if (!inQueue || !liveStatus) return null;

  const closed = liveStatus.queue?.acceptingTokens === false;
  const offline = Boolean(statusOffline || browserOffline);
  const connection = statusConnectionPresentation({
    offline,
    realtimeConnected,
    statusLastUpdatedAt,
    nowMs,
  });
  const ageLabel = connection.ageLabel;
  const queueTitle = liveStatus.queue?.name || statusQueueName;
  // Banner suppressed while paused: position is near the front but the line is
  // frozen, so "approach the counter" would be dishonest. Closed drain may still approach.
  const isCalled = liveStatus.status === "serving";
  const nearFront =
    !isCalled &&
    !paused &&
    Number.isInteger(liveStatus.position) &&
    liveStatus.position <= NEAR_FRONT_POSITION_LIMIT;

  const paceLine = isCalled
    ? null
    : formatPaceLine(
        liveStatus.position,
        liveStatus.etaServiceTime ?? liveStatus.averageServiceTime
      );
  // Live: wall clock (remaining wait). Paused: first pinned snapshot for this pause.
  const etaAsOfMs = paused
    ? (frozenEtaAsOfMs ?? statusLastUpdatedAt ?? nowMs)
    : nowMs;
  const etaPresented = presentLiveEta({
    etaMinutes: liveStatus.etaMinutes,
    asOfMs: etaAsOfMs,
    paused,
  });
  const sessionEndsAt = liveStatus.queue?.sessionEndsAt;
  const servingBoard = presentServingBoard(liveStatus.counters, liveStatus.nowServing);

  async function handleLeave() {
    const ok = await leave();
    if (ok) navigate("/queues");
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
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#FEF3C7] px-2.5 py-1 text-xs font-semibold text-[#92400E]"
              >
                <span className="size-1.5 rounded-full bg-[#D97706]" />
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
                Live
              </span>
            ) : (
              <span
                data-testid="queue-live"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary-muted px-2.5 py-1 text-xs font-semibold text-primary"
              >
                <span className="size-1.5 rounded-full bg-primary" />
                Still in line
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
              Refresh
            </Button>
            {user?.role !== "admin" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("/history")}
                data-testid="status-view-history"
              >
                View history
              </Button>
            )}
          </>
        }
      />

      <ShellContent tier="student">
        {offline ? (
          <p
            data-testid="status-offline"
            className="mb-4 rounded-lg border border-border bg-secondary px-3.5 py-2.5 text-sm text-text-secondary"
            aria-live="polite"
          >
            Offline — showing your last known place in line. Live updates resume when you’re back online.
          </p>
        ) : null}
        <header className="mb-4">
          <h1
            data-testid="status-heading"
            className="font-display text-display font-semibold leading-tight tracking-[-0.01em] text-foreground"
          >
            Your place in line
          </h1>
          {activeMemberships.length > 1 ? (
            <div
              className="mt-3 flex flex-wrap items-center gap-2"
              data-testid="status-membership-switcher"
              role="tablist"
              aria-label="Your lines"
            >
              {activeMemberships.map((row) => {
                const id = row.queue?.id;
                const name = row.queue?.name || "Queue";
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
            This queue is closed for new tokens. You are still in line and will be
            served.
            {liveStatus.queue?.reopenAt ? (
              <span data-testid="status-reopen" className="mt-1 block">
                New tokens reopen {formatCampusDateTime(liveStatus.queue.reopenAt)}.
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
            Accepting until {formatCampusDateTime(sessionEndsAt)}.
          </p>
        ) : null}

        {isCalled && (
          <div className="mb-4">
            <CalledBanner
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
            />
          </div>
        )}

        {nearFront && (
          <div className="mb-4">
            <NearFrontBanner position={liveStatus.position} />
          </div>
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
              label="Token"
              value={liveStatus.tokenNumber}
              hero
              testId="token-number"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-stretch">
              <StatusMetric label="Position" value={isCalled ? "Called" : liveStatus.position} testId="position" />
              <StatusMetric
                label="ETA"
                value={
                  <span
                    className="flex flex-col items-start gap-0.5"
                    data-eta-mode={etaPresented.mode}
                  >
                    <span data-testid="eta-clock" className="leading-none">
                      {isCalled ? "—" : etaPresented.primary}
                    </span>
                    {!isCalled && etaPresented.secondary ? (
                      <span
                        data-testid="eta-minutes"
                        className="text-sm font-medium tracking-normal text-text-muted"
                      >
                        {etaPresented.secondary}
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
          </section>

          <section data-testid="status-pass-column" className="flex flex-col gap-4">
            <ArrivalPass
              queueName={queueTitle}
              queueId={statusQueueId}
              tokenNumber={liveStatus.tokenNumber}
              arrivalPass={liveStatus.arrivalPass}
            />
            <LeaveControl leaveBusy={leaveBusy} onLeave={handleLeave} />
          </section>
        </div>

        <div className="mt-5" data-testid="status-notify-slot">
          <NotifyControls called={isCalled} />
        </div>

        {(statusError || leaveError) && (
          <div className="mt-4 space-y-2">
            {statusError && <Alert variant="destructive">{statusError}</Alert>}
            {leaveError && <Alert variant="destructive">{leaveError}</Alert>}
          </div>
        )}
      </ShellContent>
    </>
  );
}

function LeaveControl({ leaveBusy, onLeave }) {
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
          {leaveBusy ? "Leaving…" : "Leave"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="leave-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Leave this line?</AlertDialogTitle>
          <AlertDialogDescription>You lose this token.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel data-testid="leave-keep">Keep place</AlertDialogCancel>
          <AlertDialogAction
            variant="destructiveSolid"
            data-testid="leave-confirm"
            onClick={onLeave}
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatCallRemaining(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  const total = Math.max(0, Math.ceil(Number(seconds)));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes <= 0) return `${secs}s left`;
  return `${minutes}:${String(secs).padStart(2, "0")} left`;
}

function CalledBanner({ remainingSeconds, frozen, counterName }) {
  const remaining = formatCallRemaining(remainingSeconds);
  const place = counterName ? counterName : "the counter";
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="called-banner"
      className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary-muted px-4 py-3"
    >
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      <div>
        <p className="font-heading text-sm font-semibold text-foreground">
          You&apos;re being called{counterName ? ` at ${counterName}` : ""}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-text-secondary" data-testid="called-remaining">
          {frozen
            ? "Timer paused until the line resumes."
            : remaining
              ? `${remaining} to arrive at ${place}.`
              : `Please come to ${place}.`}
        </p>
      </div>
    </div>
  );
}

function NearFrontBanner({ position }) {
  const { title, body, kind } = nearFrontBannerCopy({ position });
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="near-front-banner"
      data-near-front={kind}
      className="flex items-start gap-2.5 rounded-lg border border-[#FCD34D] bg-[#FEF3C7] px-4 py-3"
    >
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#D97706]" aria-hidden="true" />
      <div>
        <p className="font-heading text-sm font-semibold text-[#92400E]">
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-[#78350F]">
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
function ArrivalPass({ queueName, queueId, tokenNumber, arrivalPass }) {
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
          className="shrink-0 self-center rounded-lg border border-border bg-card p-3 shadow-card"
          data-testid="arrival-qr"
        >
          <QRCodeSVG
            value={payload}
            size={128}
            level="M"
            marginSize={0}
            className="block h-28 w-28"
            role="img"
            aria-label={`Arrival pass QR for token ${tokenNumber}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-headline font-semibold tracking-[-0.01em] text-foreground">
            Arrival pass
          </p>
          <p className="mt-2 text-sm text-foreground">
            Token{" "}
            <span
              className="font-metric text-base font-bold tabular-nums text-primary"
              data-testid="arrival-token"
            >
              {tokenNumber}
            </span>
            <span className="text-text-muted"> · {queueName}</span>
          </p>
          <p className="mt-2 text-xs leading-5 text-text-secondary" data-testid="arrival-disclaimer">
            Show this at the counter. A scan confirms this token is waiting — not who you are.
          </p>
        </div>
      </div>
    </section>
  );
}

function StatusMetric({ label, value, hero = false, testId }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-1 rounded-md border border-border bg-secondary px-4 py-3",
        hero &&
          /* Token hero keeps the 14px radius; list metrics use radius-md. */
          "rounded-xl min-h-[6.5rem] justify-center gap-1.5 border-l-4 border-l-primary border-border bg-primary-muted px-6 py-5 sm:min-h-[7rem]"
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
          "inline-flex items-baseline font-metric text-metric tabular-nums text-foreground",
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
