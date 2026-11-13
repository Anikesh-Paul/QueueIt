import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Minimize2, Contrast, RefreshCw, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useApp } from "@/context/app-context";
import { fetchLiveView } from "@/api";
import { isGlobalAdmin, isOrgAdmin } from "@/lib/staff-access";
import {
  ROTATE_OPTIONS,
  counterStateLabel,
  focusedQueue,
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

function scopeLabel(user, data) {
  if (data?.venue?.name) return data.venue.name;
  if (user?.role === "staff") return "Your venue";
  if (isOrgAdmin(user)) return "Your organizations";
  if (isGlobalAdmin(user)) return "All organizations";
  return "Your queues";
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
      {counterStateLabel(state)}
    </span>
  );
}

function CounterThroughput({ counters, tv, testId }) {
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
              <span className="font-semibold text-foreground" data-testid="live-counter-served">{c.servedToday}</span> served
              {" · "}
              {c.servedLastHour} in last hour
            </span>
          </div>
          <div
            className={cn("mt-1.5 overflow-hidden rounded-full bg-secondary", tv ? "h-3" : "h-2")}
            role="img"
            aria-label={`${c.name}: ${c.servedToday} served today`}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${throughputPercent(c.servedToday, max)}%` }} />
          </div>
          <p className={cn("mt-1 text-text-muted", tv ? "text-base" : "text-xs")}>
            {c.nowServing != null ? `Now serving #${c.nowServing}` : "Free"}
            {c.staffedByName ? ` · ${c.staffedByName}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

function queueStatusText(queue) {
  if (queue.status === "paused") return "Paused";
  return queue.acceptingTokens ? "Taking tokens" : "Closed to new tokens";
}

function QueueCard({ queue, tv }) {
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
            {queueStatusText(queue)}
          </p>
        </div>
        <p className={cn("text-text-muted", tv ? "text-base" : "text-sm")}>
          Now serving{" "}
          <span className={cn("font-metric font-semibold tabular-nums text-foreground", tv ? "text-3xl" : "text-xl")}>
            {queue.nowServing != null ? `#${queue.nowServing}` : "—"}
          </span>
        </p>
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {[
          ["Served", queue.servedToday],
          ["Avg wait", formatWait(queue.averageWaitMinutes)],
          ["Waiting", queue.waitingCount],
          ["No-shows", queue.noShowsToday],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className={cn("text-text-muted", tv ? "text-sm" : "text-xs")}>{label}</dt>
            <dd className={cn("font-metric font-semibold tabular-nums text-foreground", tv ? "text-4xl" : "text-2xl")}>{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="mb-2 text-xs font-medium text-text-muted">
          Counters · {queue.openCounters} of {queue.totalCounters} open
        </h3>
        <CounterThroughput counters={queue.counters} testId="live-queue-counters" />
      </div>
    </section>
  );
}

function FocusView({ queue, tv }) {
  return (
    <section className="flex flex-col gap-5" data-testid="live-focus" data-name={queue.name} aria-labelledby="live-focus-title">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="live-focus-title" className={cn("truncate font-semibold tracking-[-0.02em] text-foreground", tv ? "text-5xl" : "text-3xl")}>
            {queue.name}
          </h2>
          <p className={cn("text-text-muted", tv ? "text-xl" : "text-sm")}>
            {queue.venue ? `${queue.venue} · ` : ""}
            {queueStatusText(queue)}
          </p>
        </div>
        <p className={cn("text-text-muted", tv ? "text-2xl" : "text-base")}>
          Now serving{" "}
          <span className={cn("font-metric font-semibold tabular-nums text-foreground", tv ? "text-6xl" : "text-4xl")} data-testid="live-focus-now">
            {queue.nowServing != null ? `#${queue.nowServing}` : "—"}
          </span>
        </p>
      </header>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile tv={tv} label="Served today" value={queue.servedToday} hint={`${queue.servedLastHour} in the last hour`} testId="live-focus-served" />
        <Tile tv={tv} label="Average wait" value={formatWait(queue.averageWaitMinutes)} hint="Join to call" />
        <Tile tv={tv} label="Waiting now" value={queue.waitingCount} testId="live-focus-waiting" />
        <Tile tv={tv} label="No-shows today" value={queue.noShowsToday} tone={queue.noShowsToday ? "warn" : undefined} />
        <Tile
          tv={tv}
          label="Busiest counter"
          value={queue.busiestCounter?.name || "—"}
          hint={queue.busiestCounter ? `${queue.busiestCounter.servedToday} served` : "No serves yet"}
        />
      </dl>
      <section className="rounded-lg border border-border bg-card p-4 sm:p-6" aria-labelledby="live-focus-counters">
        <h3 id="live-focus-counters" className={cn("mb-4 font-semibold text-foreground", tv ? "text-2xl" : "text-base")}>
          Counters · {queue.openCounters} of {queue.totalCounters} open
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
    document.title = "Live view · QueueIt";
    return () => {
      document.title = "QueueIt";
    };
  }, []);

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
            Live view
          </h1>
          <p className={cn("truncate text-text-muted", tv ? "text-lg" : "text-sm")} data-testid="live-scope">
            {scopeLabel(user, data)} · Today
          </p>
        </div>
        <div className="flex items-center gap-4">
          <p className={cn("font-metric tabular-nums text-foreground", tv ? "text-3xl" : "text-lg")} data-testid="live-clock">
            {formatCampusClock(new Date(now))} <span className={cn("text-text-muted", tv ? "text-lg" : "text-xs")}>IST</span>
          </p>
          <p className={cn("flex items-center gap-1.5 text-text-muted", tv ? "text-base" : "text-xs")} data-testid="live-updated">
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-full", error || stale ? "bg-warning" : "bg-primary motion-safe:animate-pulse")}
            />
            {formatAgo(lastOk, now)}
          </p>
          {tv ? (
            <Button variant="outline" size="sm" onClick={exitTv} data-testid="live-exit-tv">
              <Minimize2 aria-hidden="true" />
              Exit TV mode
            </Button>
          ) : null}
        </div>
        {!tv ? (
          <div className="flex w-full flex-wrap items-center gap-2" data-testid="live-controls">
            <label className="flex items-center gap-2 text-sm text-text-muted">
              Show
              <select
                className={selectClass}
                value={queueId || ""}
                onChange={(e) => {
                  setRotationIndex(0);
                  update({ queueId: e.target.value || null });
                }}
                data-testid="live-queue-select"
              >
                <option value="">All queues</option>
                {queues.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              Rotate
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
                    {s ? `Every ${s}s` : "Off"}
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
              High contrast
            </Button>
            <Button size="lg" onClick={enterTv} data-testid="live-enter-tv">
              <Tv aria-hidden="true" />
              TV mode
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <Button variant="ghost" size="lg" asChild>
                <Link to="/admin/catalog" data-testid="live-back">
                  Back to console
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
      </header>

      <main id="main-content" className={cn("flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6", tv && "gap-6 py-6")}>
        {error && data ? (
          <p role="status" className="rounded-md border border-warning-line bg-warning-soft px-4 py-2 text-sm text-warning-ink" data-testid="live-stale">
            Can’t reach the server. Showing the last numbers ({formatAgo(lastOk, now).toLowerCase()}); retrying automatically.
          </p>
        ) : null}

        {!data && error ? (
          <ErrorState
            testId="live-error"
            title={error.status === 403 ? "You don’t have access to the live view" : "Couldn’t load the live view"}
            message={error.status === 403 ? "Ask an admin to give you access to a venue." : "Check your connection. We’ll keep trying."}
            detail={error.message}
            onRetry={load}
          />
        ) : null}

        {!data && !error ? (
          <p className="py-24 text-center text-text-muted" aria-live="polite" data-testid="live-loading">
            <RefreshCw className="mr-2 inline size-4 motion-safe:animate-spin" aria-hidden="true" />
            Loading today’s numbers…
          </p>
        ) : null}

        {data && queues.length === 0 ? (
          <EmptyState testId="live-empty" title="No queues to show" hint="Queues you can manage will appear here with today’s numbers." />
        ) : null}

        {pinnedMissing ? (
          <EmptyState
            testId="live-missing"
            title="That queue isn’t available"
            hint="It may be archived or outside your organizations."
            action={
              <Button variant="outline" onClick={() => update({ queueId: null })}>
                Show all queues
              </Button>
            }
          />
        ) : null}

        {data && queues.length > 0 && focused ? (
          <>
            {rotating.length ? (
              <p className={cn("flex items-center gap-2 text-text-muted", tv ? "text-lg" : "text-sm")} data-testid="live-rotation">
                <span>
                  Queue {(rotationIndex % rotating.length) + 1} of {rotating.length} · changes every {rotateSeconds}s
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
              <Tile tv={tv} label="Served today" value={totals.servedToday} hint={`${totals.servedLastHour} in the last hour`} testId="live-served" />
              <Tile tv={tv} label="Average wait" value={formatWait(totals.averageWaitMinutes)} hint="Join to call" testId="live-wait" />
              <Tile tv={tv} label="Waiting now" value={totals.waitingCount} hint={`${totals.openQueues} of ${queues.length} queues open`} testId="live-waiting" />
              <Tile tv={tv} label="No-shows today" value={totals.noShowsToday} tone={totals.noShowsToday ? "warn" : undefined} testId="live-noshows" />
              <Tile tv={tv} label="Open counters" value={`${totals.openCounters}/${totals.totalCounters}`} testId="live-open-counters" />
              <Tile
                tv={tv}
                label="Busiest counter"
                value={busiest ? busiest.name : "—"}
                hint={busiest ? `${busiest.queueName} · ${busiest.servedToday} served` : "No serves yet today"}
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
