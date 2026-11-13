import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Minimize2, Contrast, RefreshCw, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useApp } from "@/context/app-context";
import { useI18n } from "@/context/i18n-context";
import { LanguageToggle } from "@/components/shell/language-toggle";
import { fetchLiveView } from "@/api";
import { isGlobalAdmin, isOrgAdmin } from "@/lib/staff-access";
import {
  ROTATE_OPTIONS,
  counterStateLabel,
  focusedQueue,
  formatCount,
  formatAgo,
  formatCampusClock,
  formatWait,
  isStale,
  liveParamsToSearch,
  livePollMs,
  nextRotationIndex,
  parseLiveParams,
  rotationQueues,
  throughputPercent,
} from "@/lib/live-view";
import { cn } from "@/lib/utils";

const selectClass =
  "h-9 rounded-md border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

function scopeLabel(user, data, t) {
  if (data?.venue?.name) return data.venue.name;
  if (user?.role === "staff") return t("live.scope.staff");
  if (isOrgAdmin(user)) return t("live.scope.org");
  if (isGlobalAdmin(user)) return t("live.scope.global");
  return t("live.scope.queues");
}

function Tile({ label, value, hint, testId, tv, tone }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 sm:px-5 sm:py-4">
      <dt className={cn("font-medium text-text-muted", tv ? "text-base xl:text-lg" : "text-sm")}>{label}</dt>
      <dd
        data-testid={testId}
        className={cn(
          "font-metric truncate font-semibold tracking-[-0.02em] tabular-nums",
          tv ? "text-5xl xl:text-6xl" : "text-3xl sm:text-4xl",
          tone === "warn" ? "text-warning-ink" : "text-foreground"
        )}
      >
        {value}
      </dd>
      {hint ? <dd className={cn("truncate text-text-muted", tv ? "text-base" : "text-xs sm:text-sm")}>{hint}</dd> : null}
    </div>
  );
}

function StateBadge({ state }) {
  const { locale } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        state === "open" ? "border-primary/40 text-primary" : state === "break" ? "border-warning-line text-warning-ink" : "border-border-strong text-text-muted"
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", state === "open" ? "bg-primary" : state === "break" ? "bg-warning" : "bg-text-muted")}
      />
      {counterStateLabel(state, locale)}
    </span>
  );
}

function CounterThroughput({ counters, tv, testId }) {
  const { t } = useI18n();
  // Bold the number wherever the language puts it (e.g. "{n} served" puts it first).
  const [servedBefore, servedAfter = ""] = t("live.servedCount").split("{n}");
  const max = Math.max(0, ...counters.map((c) => c.servedToday));
  return (
    <ul className={cn("flex flex-col", tv ? "gap-4" : "gap-3")} data-testid={testId}>
      {counters.map((c) => (
        <li key={c.id || c.name} className="min-w-0" data-testid="live-counter" data-name={c.name}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn("truncate font-medium text-foreground", tv ? "text-xl" : "text-sm")}>{c.name}</span>
              <StateBadge state={c.state} />
            </div>
            <span className={cn("tabular-nums text-text-muted", tv ? "text-lg" : "text-sm")}>
              <span>
                {servedBefore}
                <span className="font-semibold text-foreground" data-testid="live-counter-served">{c.servedToday}</span>
                {servedAfter}
              </span>
              {" · "}
              {t("live.inLastHour", { n: c.servedLastHour })}
            </span>
          </div>
          <div
            className={cn("mt-1.5 overflow-hidden rounded-full bg-secondary", tv ? "h-3" : "h-2")}
            role="img"
            aria-label={t("live.counterBar", { name: c.name, n: c.servedToday })}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${throughputPercent(c.servedToday, max)}%` }} />
          </div>
          <p className={cn("mt-1 text-text-muted", tv ? "text-base" : "text-xs")}>
            {c.nowServing != null ? t("live.nowServingToken", { token: c.nowServing }) : t("live.free")}
            {c.staffedByName ? ` · ${c.staffedByName}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

function queueStatusText(queue, t) {
  if (queue.status === "paused") return t("live.status.paused");
  return queue.acceptingTokens ? t("live.status.taking") : t("live.status.closed");
}

function QueueCard({ queue, tv }) {
  const { t, locale } = useI18n();
  return (
    <section
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-5"
      data-testid="live-queue-card"
      data-name={queue.name}
      aria-labelledby={`live-q-${queue.id}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 id={`live-q-${queue.id}`} className={cn("truncate font-semibold text-foreground", tv ? "text-2xl" : "text-lg")}>{queue.name}</h2>
          <p className={cn("truncate text-text-muted", tv ? "text-sm" : "text-xs")}>
            {queue.venue ? `${queue.venue} · ` : ""}
            {queueStatusText(queue, t)}
          </p>
        </div>
        <p className={cn("text-text-muted", tv ? "text-base" : "text-sm")}>
          {t("live.nowServing")}{" "}
          <span className={cn("font-metric font-semibold tabular-nums text-foreground", tv ? "text-3xl" : "text-xl")}>
            {queue.nowServing != null ? `#${queue.nowServing}` : "—"}
          </span>
        </p>
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {[
          [t("live.served"), formatCount(queue.servedToday, locale)],
          [t("live.avgWait"), formatWait(queue.averageWaitMinutes, locale)],
          [t("live.waiting"), formatCount(queue.waitingCount, locale)],
          [t("live.noShows"), formatCount(queue.noShowsToday, locale)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className={cn("text-text-muted", tv ? "text-sm" : "text-xs")}>{label}</dt>
            <dd className={cn("font-metric font-semibold tabular-nums text-foreground", tv ? "text-4xl" : "text-2xl")}>{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="mb-2 text-xs font-medium text-text-muted">
          {t("live.countersOpen", { open: queue.openCounters, total: queue.totalCounters })}
        </h3>
        <CounterThroughput counters={queue.counters} testId="live-queue-counters" />
      </div>
    </section>
  );
}

function FocusView({ queue, tv }) {
  const { t, locale } = useI18n();
  return (
    <section className="flex flex-col gap-5" data-testid="live-focus" data-name={queue.name} aria-labelledby="live-focus-title">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="live-focus-title" className={cn("truncate font-semibold tracking-[-0.02em] text-foreground", tv ? "text-5xl" : "text-3xl")}>
            {queue.name}
          </h2>
          <p className={cn("text-text-muted", tv ? "text-xl" : "text-sm")}>
            {queue.venue ? `${queue.venue} · ` : ""}
            {queueStatusText(queue, t)}
          </p>
        </div>
        <p className={cn("text-text-muted", tv ? "text-2xl" : "text-base")}>
          {t("live.nowServing")}{" "}
          <span className={cn("font-metric font-semibold tabular-nums text-foreground", tv ? "text-6xl" : "text-4xl")} data-testid="live-focus-now">
            {queue.nowServing != null ? `#${queue.nowServing}` : "—"}
          </span>
        </p>
      </header>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile tv={tv} label={t("live.servedToday")} value={formatCount(queue.servedToday, locale)} hint={t("live.lastHourHint", { n: queue.servedLastHour })} testId="live-focus-served" />
        <Tile tv={tv} label={t("live.averageWait")} value={formatWait(queue.averageWaitMinutes, locale)} hint={t("live.joinToCall")} />
        <Tile tv={tv} label={t("live.waitingNow")} value={formatCount(queue.waitingCount, locale)} testId="live-focus-waiting" />
        <Tile tv={tv} label={t("live.noShowsToday")} value={formatCount(queue.noShowsToday, locale)} tone={queue.noShowsToday ? "warn" : undefined} />
        <Tile
          tv={tv}
          label={t("live.busiest")}
          value={queue.busiestCounter?.name || "—"}
          hint={queue.busiestCounter ? t("live.servedCount", { n: queue.busiestCounter.servedToday }) : t("live.noServes")}
        />
      </dl>
      <section className="rounded-lg border border-border bg-card p-4 sm:p-6" aria-labelledby="live-focus-counters">
        <h3 id="live-focus-counters" className={cn("mb-4 font-semibold text-foreground", tv ? "text-2xl" : "text-base")}>
          {t("live.countersOpen", { open: queue.openCounters, total: queue.totalCounters })}
        </h3>
        <CounterThroughput counters={queue.counters} tv={tv} testId="live-focus-counters-list" />
      </section>
    </section>
  );
}

/**
 * Live staff view: a full-screen, auto-refreshing wall dashboard of today's
 * numbers for the queues this operator can see. Polls the API (no socket
 * needed on Vercel). Settings live in the URL so a TV can bookmark them.
 */
export function LiveViewPage() {
  const { token, user } = useApp();
  const { t, locale } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useMemo(() => parseLiveParams(searchParams), [searchParams]);
  const { queueId, rotateSeconds, highContrast, tv } = settings;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastOk, setLastOk] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [rotationIndex, setRotationIndex] = useState(0);
  const failures = useRef(0);
  const timer = useRef(null);
  const refreshSeconds = useRef(undefined);

  const update = useCallback(
    (patch) => setSearchParams(liveParamsToSearch({ ...settings, ...patch }), { replace: true }),
    [settings, setSearchParams]
  );

  const load = useCallback(async () => {
    try {
      const next = await fetchLiveView(token);
      setData(next);
      refreshSeconds.current = next?.refreshSeconds;
      setError(null);
      setLastOk(Date.now());
      failures.current = 0;
    } catch (err) {
      failures.current += 1;
      setError(err);
    }
  }, [token]);

  // Poll: a setTimeout chain so the next delay can follow refreshSeconds and back off on errors.
  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      window.clearTimeout(timer.current);
      const ms = livePollMs({ hidden: document.visibilityState === "hidden", refreshSeconds: refreshSeconds.current, failures: failures.current });
      if (ms == null || cancelled) return;
      timer.current = window.setTimeout(async () => {
        await load();
        if (!cancelled) schedule();
      }, ms);
    };
    const run = async () => {
      await load();
      if (!cancelled) schedule();
    };
    run();
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
      else window.clearTimeout(timer.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Wall clock + "updated Xs ago".
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const queues = data?.queues || [];
  const rotating = rotationQueues(queues, settings);
  useEffect(() => {
    if (!rotating.length) return undefined;
    const id = window.setInterval(() => setRotationIndex((i) => nextRotationIndex(i, rotating.length)), rotateSeconds * 1000);
    return () => window.clearInterval(id);
  }, [rotating.length, rotateSeconds]);

  const focused = focusedQueue(queues, { ...settings, rotationIndex });
  const pinnedMissing = Boolean(queueId && data && !focused);

  // TV mode: try fullscreen and keep the screen awake; Esc leaves TV mode.
  useEffect(() => {
    if (!tv) return undefined;
    let lock = null;
    navigator.wakeLock?.request?.("screen").then((l) => (lock = l)).catch(() => {});
    const onKey = (e) => {
      if (e.key === "Escape") update({ tv: false });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      lock?.release?.().catch(() => {});
    };
  }, [tv, update]);

  useEffect(() => {
    document.title = t("live.docTitle");
    return () => {
      document.title = "QueueIt";
    };
  }, [t]);

  function enterTv() {
    update({ tv: true });
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
  function exitTv() {
    update({ tv: false });
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  const stale = isStale(lastOk, now, data?.refreshSeconds);
  const totals = data?.totals;
  const busiest = data?.busiestCounter;

  return (
    <div
      className={cn("live-view flex min-h-dvh flex-col bg-background text-foreground", highContrast && "live-hc", tv && "live-tv")}
      data-testid="live-view"
      data-tv={tv ? "1" : "0"}
      data-contrast={highContrast ? "high" : "normal"}
    >
      <header className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-4 sm:px-6", tv ? "py-4" : "py-3")}>
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className={cn("font-semibold tracking-[-0.02em] text-foreground", tv ? "text-3xl" : "text-xl")} data-testid="live-heading">
            {t("live.title")}
          </h1>
          <p className={cn("truncate text-text-muted", tv ? "text-lg" : "text-sm")} data-testid="live-scope">
            {scopeLabel(user, data, t)} · {t("live.today")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <p className={cn("font-metric tabular-nums text-foreground", tv ? "text-3xl" : "text-lg")} data-testid="live-clock">
            {formatCampusClock(new Date(now), locale)} <span className={cn("text-text-muted", tv ? "text-lg" : "text-xs")}>IST</span>
          </p>
          <p className={cn("flex items-center gap-1.5 text-text-muted", tv ? "text-base" : "text-xs")} data-testid="live-updated">
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-full", error || stale ? "bg-warning" : "bg-primary motion-safe:animate-pulse")}
            />
            {formatAgo(lastOk, now, locale)}
          </p>
          {tv ? (
            <Button variant="outline" size="sm" onClick={exitTv} data-testid="live-exit-tv">
              <Minimize2 aria-hidden="true" />
              {t("live.exitTv")}
            </Button>
          ) : null}
        </div>
        {!tv ? (
          <div className="flex w-full flex-wrap items-center gap-2" data-testid="live-controls">
            <label className="flex items-center gap-2 text-sm text-text-muted">
              {t("live.show")}
              <select
                className={selectClass}
                value={queueId || ""}
                onChange={(e) => {
                  setRotationIndex(0);
                  update({ queueId: e.target.value || null });
                }}
                data-testid="live-queue-select"
              >
                <option value="">{t("live.allQueues")}</option>
                {queues.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              {t("live.rotate")}
              <select
                className={selectClass}
                value={rotateSeconds}
                disabled={Boolean(queueId)}
                onChange={(e) => {
                  setRotationIndex(0);
                  update({ rotateSeconds: Number(e.target.value) });
                }}
                data-testid="live-rotate-select"
              >
                {ROTATE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s ? t("live.rotateEvery", { n: s }) : t("live.rotateOff")}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="lg"
              aria-pressed={highContrast}
              onClick={() => update({ highContrast: !highContrast })}
              data-testid="live-contrast"
            >
              <Contrast aria-hidden="true" />
              {t("live.highContrast")}
            </Button>
            <Button size="lg" onClick={enterTv} data-testid="live-enter-tv">
              <Tv aria-hidden="true" />
              {t("live.tvMode")}
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <LanguageToggle />
              <ThemeToggle />
              <Button variant="ghost" size="lg" asChild>
                <Link to="/admin/catalog" data-testid="live-back">
                  {t("live.back")}
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
      </header>

      <main id="main-content" className={cn("flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6", tv && "gap-6 py-6")}>
        {error && data ? (
          <p role="status" className="rounded-md border border-warning-line bg-warning-soft px-4 py-2 text-sm text-warning-ink" data-testid="live-stale">
            {t("live.stale", { ago: formatAgo(lastOk, now, locale) })}
          </p>
        ) : null}

        {!data && error ? (
          <ErrorState
            testId="live-error"
            title={error.status === 403 ? t("live.noAccessTitle") : t("live.loadFailedTitle")}
            message={error.status === 403 ? t("live.noAccessBody") : t("live.loadFailedBody")}
            retryLabel={t("error.retry")}
            detail={error.message}
            onRetry={load}
          />
        ) : null}

        {!data && !error ? (
          <p className="py-24 text-center text-text-muted" aria-live="polite" data-testid="live-loading">
            <RefreshCw className="mr-2 inline size-4 motion-safe:animate-spin" aria-hidden="true" />
            {t("live.loading")}
          </p>
        ) : null}

        {data && queues.length === 0 ? (
          <EmptyState testId="live-empty" title={t("live.emptyTitle")} hint={t("live.emptyHint")} />
        ) : null}

        {pinnedMissing ? (
          <EmptyState
            testId="live-missing"
            title={t("live.missingTitle")}
            hint={t("live.missingHint")}
            action={
              <Button variant="outline" onClick={() => update({ queueId: null })}>
                {t("live.showAll")}
              </Button>
            }
          />
        ) : null}

        {data && queues.length > 0 && focused ? (
          <>
            {rotating.length ? (
              <p className={cn("flex items-center gap-2 text-text-muted", tv ? "text-lg" : "text-sm")} data-testid="live-rotation">
                <span>
                  {t("live.rotation", { i: (rotationIndex % rotating.length) + 1, n: rotating.length, s: rotateSeconds })}
                </span>
                <span className="flex gap-1" aria-hidden="true">
                  {rotating.map((q, i) => (
                    <span key={q.id} className={cn("size-2 rounded-full", i === rotationIndex % rotating.length ? "bg-primary" : "bg-border-strong")} />
                  ))}
                </span>
              </p>
            ) : null}
            <FocusView queue={focused} tv={tv} />
          </>
        ) : null}

        {data && queues.length > 0 && !focused && !pinnedMissing ? (
          <>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="live-totals">
              <Tile tv={tv} label={t("live.servedToday")} value={formatCount(totals.servedToday, locale)} hint={t("live.lastHourHint", { n: totals.servedLastHour })} testId="live-served" />
              <Tile tv={tv} label={t("live.averageWait")} value={formatWait(totals.averageWaitMinutes, locale)} hint={t("live.joinToCall")} testId="live-wait" />
              <Tile tv={tv} label={t("live.waitingNow")} value={formatCount(totals.waitingCount, locale)} hint={t("live.queuesOpen", { open: totals.openQueues, total: queues.length })} testId="live-waiting" />
              <Tile tv={tv} label={t("live.noShowsToday")} value={formatCount(totals.noShowsToday, locale)} tone={totals.noShowsToday ? "warn" : undefined} testId="live-noshows" />
              <Tile tv={tv} label={t("live.openCounters")} value={`${totals.openCounters}/${totals.totalCounters}`} testId="live-open-counters" />
              <Tile
                tv={tv}
                label={t("live.busiest")}
                value={busiest ? busiest.name : "—"}
                hint={busiest ? t("live.busiestHint", { queue: busiest.queueName, n: busiest.servedToday }) : t("live.noServesToday")}
                testId="live-busiest"
              />
            </dl>
            <div className={cn("grid items-start gap-4", tv ? "lg:grid-cols-2 2xl:grid-cols-3" : "lg:grid-cols-2")} data-testid="live-queues">
              {queues.map((q) => (
                <QueueCard key={q.id} queue={q} tv={tv} />
              ))}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
