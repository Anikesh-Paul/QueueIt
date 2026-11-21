import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Wordmark } from "@/components/brand/wordmark";
import { LanguageToggle } from "@/components/shell/language-toggle";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { SkipToContent } from "@/components/shell/skip-to-content";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useI18n } from "@/context/i18n-context";
import { fetchStatusBoard } from "@/api";
import { MAIN_CONTENT_ID } from "@/lib/skip-to-content";
import { joinPath } from "@/lib/join-link";
import { formatWaitingOccupancy } from "@/lib/waiting-occupancy";
import { cn } from "@/lib/utils";
import {
  boardLastUpdated,
  boardWaitCopy,
  groupStatusBoard,
  parseStatusBoardParams,
  statusBoardPath,
} from "@/lib/status-board";
import { catalogServingNote } from "@/lib/now-serving";
import { waitLevel } from "@/lib/wait-estimate";

function queueStateId(queue) {
  if (queue?.acceptingTokens === false) return "closed";
  if (queue?.status === "paused") return "paused";
  return "open";
}

function peopleHint(people, tickets, t) {
  const n = Number(people);
  if (!Number.isFinite(n) || n <= Number(tickets || 0)) return null;
  return t("live.people", { n });
}

function QueueCard({ queue, showOrg, heading: Heading = "h3" }) {
  const { t, locale } = useI18n();
  const stateId = queueStateId(queue);
  const wait = boardWaitCopy(queue.waitEstimate, locale);
  const join = joinPath(queue.id);
  const occupancy = formatWaitingOccupancy({ waitingCount: queue.waitingCount, locale });
  const people = peopleHint(queue.waitingPeople, queue.waitingCount, t);
  const place = showOrg && queue.organization?.name
    ? `${queue.organization.name} · ${queue.venue?.name || ""}`
    : "";
  const waitFallback =
    stateId === "paused" ? t("state.paused") : stateId === "closed" ? t("live.status.closed") : t("estimate.catalogNone");

  return (
    <article
      className="wait-rail flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card py-4 pr-4 pl-5 sm:py-5 sm:pr-5 sm:pl-6"
      data-wait-level={stateId === "closed" ? "closed" : waitLevel(queue.waitEstimate)}
      data-testid="board-card"
      data-name={queue.name}
      aria-labelledby={`board-q-${queue.id}`}
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Heading id={`board-q-${queue.id}`} className="truncate font-heading text-title text-foreground">
            {queue.name}
          </Heading>
          {place ? <p className="truncate text-sm text-text-muted">{place}</p> : null}
        </div>
        <span
          data-testid="board-status"
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
            stateId === "closed" && "bg-secondary text-text-secondary",
            stateId === "paused" && "bg-warning-soft text-warning-ink",
            stateId === "open" && "bg-primary-muted text-primary"
          )}
        >
          {t(`state.${stateId}`)}
        </span>
      </header>
      <p className="mt-1 text-title font-semibold text-foreground" data-testid="board-wait">
        {wait.wait || waitFallback}
        {wait.confidence ? <span className="text-sm font-normal text-text-muted"> · {wait.confidence}</span> : null}
      </p>
      <p className="text-sm text-text-secondary">
        <span data-testid="board-waiting">{occupancy}</span>
        {people ? <span data-testid="board-people"> · {people}</span> : null}
        {" · "}
        <span className="min-w-0" data-testid="board-now-serving">
          {catalogServingNote({ counters: queue.counters, waitingCount: queue.waitingCount, locale })}
        </span>
      </p>
      {queue.totalCounters > 1 ? (
        <p className="text-xs text-text-muted" data-testid="board-counters">
          {t("live.countersOpen", { open: queue.openCounters, total: queue.totalCounters })}
        </p>
      ) : null}
      {join ? (
        <Button asChild size="sm" variant={stateId === "open" ? "default" : "outline"} className="mt-2 h-9 self-start px-3.5">
          <Link to={join} data-testid="board-join">
            {t("board.join")}
          </Link>
        </Button>
      ) : null}
    </article>
  );
}

/**
 * Public, no-login campus wait board. Safe to share in chat or put on a lobby screen.
 */
export function StatusBoardPage() {
  const { t, locale } = useI18n();
  const [searchParams] = useSearchParams();
  const filters = useMemo(() => parseStatusBoardParams(searchParams), [searchParams]);

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const next = await fetchStatusBoard(filters);
      setData(next);
      setError(null);
      setMissing(false);
    } catch (err) {
      if (err.status === 404) {
        setMissing(true);
        setData(null);
        setError(null);
        return;
      }
      setError(err);
    }
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      await load();
    }
    tick();
    const poll = window.setInterval(tick, 15_000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  useEffect(() => {
    document.title = t("board.docTitle");
    return () => {
      document.title = "QueueIt";
    };
  }, [t]);

  const [copied, setCopied] = useState(false);
  async function copyLink() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("input");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const grouped = groupStatusBoard(data?.queues || []);
  const generatedAt = data?.generatedAt;
  const ttl = data?.cacheTtlSeconds || 20;

  return (
    <div className="flex min-h-dvh flex-col bg-background" data-testid="status-board">
      <SkipToContent />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Wordmark to="/status-board" />
          <div className="flex flex-wrap items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={copyLink}
              data-testid="board-copy"
              aria-live="polite"
            >
              {copied ? t("board.copied") : t("board.copy")}
            </Button>
          </div>
        </div>
      </header>

      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 outline-none sm:px-6 sm:py-8"
      >
        <div className="min-w-0">
          <h1 className="page-title" data-testid="board-heading">
            {t("board.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">{t("board.subtitle")}</p>
          <p className="mt-2 text-xs text-text-muted" data-testid="board-updated">
            {boardLastUpdated(generatedAt, now, locale)}
            {" · "}
            {t("board.lag", { n: ttl })}
          </p>
        </div>

        {error && data ? (
          <p className="rounded-md border border-warning-line bg-warning-soft px-4 py-2 text-sm text-warning-ink" role="status" data-testid="board-stale">
            {t("board.stale", { ago: boardLastUpdated(generatedAt, now, locale) })}
          </p>
        ) : null}

        {missing ? (
          <EmptyState
            testId="board-missing"
            title={t("board.missingTitle")}
            hint={t("board.missingHint")}
            action={
              <Button asChild variant="outline" size="sm">
                <Link to={statusBoardPath()} data-testid="board-show-all">
                  {t("board.showAll")}
                </Link>
              </Button>
            }
          />
        ) : error && !data ? (
          <ErrorState
            testId="board-error"
            title={t("board.loadFailedTitle")}
            message={t("board.loadFailedBody")}
            onRetry={load}
            retryLabel={t("common.refresh")}
          />
        ) : !data ? (
          <p className="text-sm text-text-muted" data-testid="board-loading">
            {t("board.loading")}
          </p>
        ) : grouped.groups.length === 0 ? (
          <EmptyState testId="board-empty" title={t("board.emptyTitle")} hint={t("board.emptyHint")} />
        ) : (
          grouped.groups.map((group) => (
            <section key={group.org.id} className="flex min-w-0 flex-col gap-5" data-testid="board-org" data-slug={group.org.slug}>
              {grouped.showOrgHeadings ? (
                <h2 className="font-heading text-headline font-semibold text-foreground">{group.org.name}</h2>
              ) : null}
              {group.venues.map((venueGroup) => (
                <section key={venueGroup.venue.id} className="flex min-w-0 flex-col gap-3" data-testid="board-venue" data-slug={venueGroup.venue.slug}>
                  {grouped.showOrgHeadings ? (
                    <h3 className="font-heading text-title font-semibold text-foreground">{venueGroup.venue.name}</h3>
                  ) : (
                    <h2 className="font-heading text-headline font-semibold text-foreground">{venueGroup.venue.name}</h2>
                  )}
                  <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
                    {venueGroup.queues.map((queue) => (
                      <QueueCard
                        key={queue.id}
                        queue={queue}
                        showOrg={grouped.showOrgHeadings}
                        heading={grouped.showOrgHeadings ? "h4" : "h3"}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </section>
          ))
        )}
      </main>
    </div>
  );
}
