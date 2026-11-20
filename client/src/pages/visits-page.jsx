import { useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ListChecks, MessageSquareText, Star, Ticket, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { ShellContent } from "@/components/shell/shell-content";
import { MotifIllustration } from "@/components/brand/motif-illustration";
import { FeedbackForm, RatingStars } from "@/components/feedback/feedback-form";
import { useApp } from "@/context/app-context";
import { useI18n } from "@/context/i18n-context";
import { fetchMyVisits } from "@/api";
import { canRateVisit } from "@/lib/feedback";
import { formatCampusDateTime } from "@/lib/campus-time";
import { cn } from "@/lib/utils";
import { PartyBadge } from "@/components/party/party-badge";
import {
  VISITS_PAGE_SIZE,
  formatWait,
  hasActiveFilters,
  outcomeKey,
  outcomeTone,
  pageList,
  rangeError,
  readVisitFilters,
  visitAsRateable,
  visitFilterParams,
} from "@/lib/visits";

const controlClass =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive";

function StatCard({ icon: Icon, label, value, hint, testId }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-card" data-testid={testId}>
      <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-text-secondary sm:text-xs">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-2 font-display text-[1.5rem] font-semibold sm:text-[1.75rem] leading-none tracking-[-0.02em] text-foreground" data-testid={`${testId}-value`}>
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

function TopQueues({ queues, total, t }) {
  return (
    <div className="col-span-2 rounded-md border border-border bg-card p-4 shadow-card lg:col-span-4" data-testid="visits-top-queues">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">
        <ListChecks className="size-3.5" aria-hidden="true" />
        {t("visits.topQueues")}
      </p>
      {queues.length ? (
        <ol className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-3">
          {queues.map((q) => {
            const share = total ? Math.max(6, Math.round((q.visits / total) * 100)) : 0;
            return (
              <li key={q.id} data-testid="visits-top-queue">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium text-foreground">{q.name || t("common.queue")}</span>
                  <span className="shrink-0 text-xs text-text-secondary">{t("visits.visitCount", { count: q.visits })}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-text-muted">{t("visits.topQueuesEmpty")}</p>
      )}
    </div>
  );
}

function VisitFeedback({ visit, rated, open, onOpen, onClose, onRated, nowMs, t }) {
  const rating = rated ?? visit.feedback?.rating ?? null;
  if (rating) {
    return (
      <div className="flex flex-col gap-1" data-testid="visit-feedback">
        <p className="flex items-center gap-2 text-xs text-text-secondary" data-testid="history-rated">
          <RatingStars rating={rating} />
        </p>
        {visit.feedback?.comment ? (
          <p className="flex items-start gap-1.5 text-sm text-text-secondary">
            <MessageSquareText className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="line-clamp-2">“{visit.feedback.comment}”</span>
          </p>
        ) : null}
      </div>
    );
  }
  if (!canRateVisit(visitAsRateable(visit), nowMs)) {
    return visit.outcome === "served" ? (
      <p className="text-xs text-text-muted" data-testid="visit-feedback">{t("visits.noFeedback")}</p>
    ) : null;
  }
  if (!open) {
    return (
      <Button variant="link" size="sm" className="h-auto px-0 text-sm" onClick={onOpen} data-testid="history-rate">
        {t("feedback.rate")}
      </Button>
    );
  }
  return (
    <div className="w-full border-t border-border pt-3">
      <FeedbackForm visit={{ entryId: visit.id }} testId="history-feedback" onSubmitted={onRated} onDismiss={onClose} />
    </div>
  );
}

function VisitRow({ visit, locale, t, ...feedback }) {
  const wait = formatWait(visit.waitMinutes, t);
  return (
    <li
      data-testid="visit-item"
      data-outcome={visit.outcome}
      className="rounded-md border border-border bg-card p-4 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="truncate font-heading text-title text-foreground" data-testid="visit-queue">
            {visit.queue?.name || t("common.queue")}
          </p>
          <p className="mt-0.5 text-sm text-text-muted" data-testid="visit-date">
            {formatCampusDateTime(visit.joinedAt, locale)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-semibold text-text-secondary">{t("history.token", { token: visit.tokenNumber })}</span>
          <PartyBadge size={visit.partySize} label={t("party.badge", { count: visit.partySize })} testId="visit-party" />
          <span
            className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", outcomeTone(visit.outcome))}
            data-testid="visit-outcome"
          >
            {t(outcomeKey(visit.outcome))}
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/70 pt-3">
        <p className="flex items-center gap-1.5 text-sm text-text-secondary" data-testid="visit-wait">
          <Clock3 className="size-3.5" aria-hidden="true" />
          {wait ? t("visits.waited", { wait }) : visit.outcome === "active" ? t("visits.stillWaiting") : t("visits.waitUnknown")}
        </p>
        <VisitFeedback visit={visit} t={t} {...feedback} />
      </div>
    </li>
  );
}

function Pagination({ page, totalPages, total, pageSize, onPage, t }) {
  if (total <= pageSize) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-between" aria-label={t("visits.pagination")} data-testid="visits-pagination">
      <p className="text-sm text-text-secondary" data-testid="visits-range">
        {t("visits.showing", { first, last, total })}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          data-testid="visits-page-prev"
          aria-label={t("visits.prevPage")}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t("visits.prev")}</span>
        </Button>
        {pageList(page, totalPages).map((n, i) =>
          n == null ? (
            <span key={`gap-${i}`} className="px-1 text-text-muted" aria-hidden="true">
              …
            </span>
          ) : (
            <Button
              key={n}
              variant={n === page ? "default" : "ghost"}
              size="sm"
              className="min-w-9"
              onClick={() => onPage(n)}
              aria-current={n === page ? "page" : undefined}
              aria-label={t("visits.pageN", { page: n })}
              data-testid={`visits-page-${n}`}
            >
              {n}
            </Button>
          )
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          data-testid="visits-page-next"
          aria-label={t("visits.nextPage")}
        >
          <span className="hidden sm:inline">{t("visits.next")}</span>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

/** Signed-in student's visit history: stats, filters, paged ticket list. */
export function MyVisitsPage() {
  const { t, locale } = useI18n();
  const { token } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readVisitFilters(searchParams);
  const filterKey = visitFilterParams(filters).toString();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ratingOpen, setRatingOpen] = useState(null);
  const [rated, setRated] = useState({});
  const [nowMs] = useState(() => Date.now());
  const ids = { queue: useId(), from: useId(), to: useId(), range: useId() };
  const backwards = rangeError(filters);

  const [reloadTick, setReloadTick] = useState(0);
  const load = () => setReloadTick((n) => n + 1);

  useEffect(() => {
    if (!token || backwards) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams(filterKey);
    params.set("pageSize", String(VISITS_PAGE_SIZE));
    fetchMyVisits(token, params)
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, filterKey, backwards, reloadTick]);

  function update(patch) {
    const next = { ...filters, ...patch };
    if (!("page" in patch)) next.page = 1;
    setSearchParams(visitFilterParams(next), { replace: !("page" in patch) });
  }

  function goToPage(n) {
    update({ page: n });
    document.getElementById("visits-list-heading")?.focus();
  }

  const summary = data?.summary;
  const visits = data?.visits || [];
  const filtered = hasActiveFilters(filters);
  const avg = summary ? formatWait(summary.averageWaitMinutes, t) : null;

  return (
    <ShellContent tier="student">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 data-testid="history-heading" className="font-heading text-headline leading-tight text-foreground">
            {t("visits.title")}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">{t("visits.intro")}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading || backwards} data-testid="history-refresh">
          {t("common.refresh")}
        </Button>
      </header>

      <section aria-label={t("visits.summaryLabel")} className="mb-6">
        {loading && !data ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-md" />
            ))}
          </div>
        ) : summary ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="visits-summary">
            <StatCard icon={Ticket} label={t("visits.statTotal")} value={summary.totalVisits} hint={filtered ? t("visits.statFiltered") : t("visits.statAllTime")} testId="visits-stat-total" />
            <StatCard icon={Clock3} label={t("visits.statWait")} value={avg || "—"} hint={t("visits.statWaitHint")} testId="visits-stat-wait" />
            <StatCard icon={CheckCircle2} label={t("visits.statServedTitle")} value={summary.served} hint={t("visits.statServedHint")} testId="visits-stat-served" />
            <StatCard icon={UserX} label={t("visits.statNoShows")} value={summary.noShows} hint={t("visits.statNoShowHint")} testId="visits-stat-noshow" />
            <TopQueues queues={summary.topQueues || []} total={summary.totalVisits} t={t} />
          </div>
        ) : null}
      </section>

      <section aria-labelledby={ids.range} className="mb-5 rounded-md border border-border bg-card p-4 shadow-card" data-testid="visits-filters">
        <h2 id={ids.range} className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <CalendarRange className="size-4 text-text-secondary" aria-hidden="true" />
          {t("visits.filters")}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end">
          <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
            <label htmlFor={ids.queue} className="text-sm font-medium text-foreground">
              {t("visits.filterQueue")}
            </label>
            <select
              id={ids.queue}
              className={controlClass}
              value={filters.queue}
              onChange={(e) => update({ queue: e.target.value })}
              data-testid="visits-filter-queue"
            >
              <option value="">{t("visits.allQueues")}</option>
              {(data?.queues || []).map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name || t("common.queue")}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.from} className="text-sm font-medium text-foreground">
              {t("visits.filterFrom")}
            </label>
            <input
              id={ids.from}
              type="date"
              className={controlClass}
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => update({ from: e.target.value })}
              aria-invalid={backwards || undefined}
              aria-describedby={backwards ? "visits-range-error" : undefined}
              data-testid="visits-filter-from"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.to} className="text-sm font-medium text-foreground">
              {t("visits.filterTo")}
            </label>
            <input
              id={ids.to}
              type="date"
              className={controlClass}
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => update({ to: e.target.value })}
              aria-invalid={backwards || undefined}
              aria-describedby={backwards ? "visits-range-error" : undefined}
              data-testid="visits-filter-to"
            />
          </div>
          <Button
            variant="secondary"
            className="col-span-2 h-10 sm:col-span-1"
            onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
            disabled={!filtered}
            data-testid="visits-filter-clear"
          >
            {t("visits.clearFilters")}
          </Button>
        </div>
        {backwards ? (
          <p id="visits-range-error" role="alert" className="mt-2 text-sm font-medium text-destructive" data-testid="visits-range-error">
            {t("visits.rangeError")}
          </p>
        ) : null}
      </section>

      <h2 id="visits-list-heading" tabIndex={-1} className="sr-only">
        {t("visits.listLabel")}
      </h2>

      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label={t("history.loading")}>
          <Skeleton className="h-28 rounded-md" />
          <Skeleton className="h-28 rounded-md" />
        </div>
      ) : null}

      {!loading && error ? (
        <ErrorState
          testId="history-error"
          title={t("error.loadHistory")}
          message={t("error.connection")}
          detail={error}
          retryLabel={t("error.retry")}
          onRetry={load}
        />
      ) : null}

      {!loading && !error && !backwards && data && visits.length === 0 ? (
        <div data-testid={filtered ? "visits-no-match" : "history-empty"} className="rounded-md border border-border bg-card px-5 py-12 text-center shadow-card">
          <MotifIllustration motif="foldedPass" variant="empty" className="mb-4" />
          <p className="font-display text-display font-semibold tracking-[-0.01em] text-foreground">
            {filtered ? t("visits.noMatch") : t("history.empty")}
          </p>
          <p className="mt-1 text-sm text-text-secondary">{filtered ? t("visits.noMatchHint") : t("history.emptyUser")}</p>
          {filtered ? (
            <Button variant="secondary" className="mt-5" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
              {t("visits.clearFilters")}
            </Button>
          ) : (
            <Button asChild className="mt-5">
              <Link to="/queues">{t("visits.browseQueues")}</Link>
            </Button>
          )}
        </div>
      ) : null}

      {!loading && !error && !backwards && visits.length > 0 ? (
        <>
          <ul className="flex flex-col gap-3" data-testid="visits-list" aria-labelledby="visits-list-heading">
            {visits.map((visit) => (
              <VisitRow
                key={visit.id}
                visit={visit}
                locale={locale}
                t={t}
                nowMs={nowMs}
                rated={rated[visit.id]}
                open={ratingOpen === visit.id}
                onOpen={() => setRatingOpen(visit.id)}
                onClose={() => setRatingOpen(null)}
                onRated={(value) => setRated((map) => ({ ...map, [visit.id]: value }))}
              />
            ))}
          </ul>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            onPage={goToPage}
            t={t}
          />
        </>
      ) : null}

      <p className="mt-8 flex items-center gap-1.5 text-sm text-text-secondary">
        <Star className="size-4 text-attention" aria-hidden="true" />
        {t("visits.starTip")}
      </p>
    </ShellContent>
  );
}
