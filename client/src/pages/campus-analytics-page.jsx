import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { useApp } from "@/context/app-context";
import { PageToolbar } from "@/components/shell/page-toolbar";
import { ShellContent } from "@/components/shell/shell-content";
import { fetchAnalyticsReport, downloadAnalyticsReportCsv, fetchAdminCatalog } from "@/api";
import {
  RANGE_PRESETS,
  barPercent,
  campusDate,
  formatHour,
  formatMinutes,
  formatRangeLabel,
  formatRate,
  formatShortDate,
  labelStride,
  niceMax,
  presetRange,
  reportQuery,
  validateRange,
} from "@/lib/analytics-report";
import { cn } from "@/lib/utils";

const selectClass =
  "h-9 rounded-md border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

function Kpi({ label, value, hint, testId }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-4 sm:px-5">
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd data-testid={testId} className="font-metric text-2xl font-semibold tracking-[-0.02em] tabular-nums text-foreground">
        {value}
      </dd>
      {hint ? <dd className="truncate text-xs text-text-muted">{hint}</dd> : null}
    </div>
  );
}

function Panel({ title, subtitle, children, testId, className }) {
  return (
    <section data-testid={testId} className={cn("overflow-hidden rounded-lg border border-border bg-card shadow-card", className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle ? <p className="text-xs text-text-muted">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * Plain column chart. Bars carry a title for hover and the panel ships a
 * screen-reader table, so the chart itself is aria-hidden.
 */
function ColumnChart({ points, height = 168, testId, emptyText }) {
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const stride = labelStride(points.length, points.length > 12 ? 8 : 12);
  const total = points.reduce((s, p) => s + p.value, 0);
  if (!total) {
    return (
      <p className="px-5 py-10 text-center text-sm text-text-muted" data-testid={`${testId}-empty`}>
        {emptyText}
      </p>
    );
  }
  return (
    <div className="px-5 pt-4 pb-3" data-testid={testId}>
      <div className="flex gap-2" aria-hidden="true">
        <div className="flex w-6 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-text-muted" style={{ height }}>
          <span>{max}</span>
          <span>{max / 2 >= 1 ? Math.round(max / 2) : ""}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" />
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border" style={{ top: height / 2 }} />
          <div className="flex items-end gap-[3px] border-b border-border-strong" style={{ height }}>
            {points.map((p) => (
              <div key={p.key} className="flex h-full min-w-0 flex-1 items-end" title={`${p.title}: ${p.value}`}>
                <div
                  className={cn("w-full rounded-t-[3px]", p.highlight ? "bg-primary" : "bg-primary/55")}
                  style={{ height: `${barPercent(p.value, max)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-[3px] text-[11px] text-text-muted">
            {points.map((p, i) => (
              <span key={p.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
                {i % stride === 0 ? p.label : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SrTable({ caption, headers, rows }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} scope="col">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]}>
            {r.map((c, i) => (i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RateCell({ rate }) {
  const tone = rate == null ? "text-text-muted" : rate >= 0.2 ? "text-destructive" : rate >= 0.1 ? "text-warning-ink" : "text-foreground";
  return <span className={cn("tabular-nums", tone)}>{formatRate(rate)}</span>;
}

/**
 * Admin analytics — campus-day range report with daily served, peak hours,
 * no-show rate and per-queue waits. Staff are locked to their venue / queues.
 */
export function CampusAnalyticsPage() {
  const navigate = useNavigate();
  const { token, user } = useApp();
  const isStaffUser = user?.role === "staff";
  const initial = presetRange("7d");
  const [preset, setPreset] = useState("7d");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [draft, setDraft] = useState(initial);
  const [venueId, setVenueId] = useState("");
  const [queueId, setQueueId] = useState("");
  const [venues, setVenues] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const today = campusDate();

  useEffect(() => {
    if (!token) return;
    fetchAdminCatalog(token)
      .then((payload) => setVenues(payload.venues || []))
      .catch(() => setVenues([]));
  }, [token]);

  const queueOptions = useMemo(() => {
    const list = [];
    for (const venue of venues) {
      if (venueId && venue.id !== venueId) continue;
      for (const q of venue.queues || []) {
        if (!q.archivedAt) list.push({ id: q.id, name: q.name, venue: venue.name });
      }
    }
    return list;
  }, [venues, venueId]);

  const query = reportQuery({ from, to, venueId, queueId });

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchAnalyticsReport(token, query)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
          setError(err.message || "Could not load analytics");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, query, reloadKey]);

  function choosePreset(id) {
    setPreset(id);
    setRangeError("");
    if (id === "custom") {
      setDraft({ from, to });
      return;
    }
    const next = presetRange(id);
    setFrom(next.from);
    setTo(next.to);
  }

  function applyCustom(event) {
    event.preventDefault();
    const message = validateRange(draft.from, draft.to);
    setRangeError(message);
    if (message) return;
    setFrom(draft.from);
    setTo(draft.to);
  }

  async function handleExport() {
    if (!token || exporting) return;
    setExporting(true);
    setError("");
    try {
      await downloadAnalyticsReportCsv(token, query, `queueit-report-${from}-to-${to}.csv`);
    } catch (err) {
      setError(err.message || "Could not export CSV");
    } finally {
      setExporting(false);
    }
  }

  const totals = data?.totals;
  const year = Number(to.slice(0, 4));
  const dailyPoints = (data?.daily || []).map((d) => ({
    key: d.date,
    label: formatShortDate(d.date, year),
    title: formatShortDate(d.date, year),
    value: d.served,
    highlight: totals?.busiestDay?.date === d.date,
  }));
  const hourlyPoints = (data?.hourly || []).map((h) => ({
    key: h.hour,
    label: h.hour % 3 === 0 ? formatHour(h.hour).replace(" ", "") : "",
    title: formatHour(h.hour),
    value: h.served,
    highlight: totals?.peakHour === h.hour,
  }));
  const scopeLabel = data?.venue?.name || (isStaffUser ? "Your venue" : "All venues");
  const queueLabel = queueId ? queueOptions.find((q) => q.id === queueId)?.name : null;
  const maxQueueWait = Math.max(1, ...(data?.queues || []).map((q) => q.averageWaitMinutes || 0));

  return (
    <>
      <PageToolbar
        tier="admin"
        title={<span data-testid="campus-analytics-scope">{queueLabel ? `${scopeLabel} · ${queueLabel}` : scopeLabel}</span>}
        meta={<span data-testid="analytics-range-label">{formatRangeLabel(from, to)} · IST</span>}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={loading || exporting || !data}
              data-testid="campus-analytics-export"
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/catalog")} data-testid="campus-analytics-back">
              Back to catalog
            </Button>
          </>
        }
      />

      <ShellContent tier="admin">
        <header className="mb-5">
          <h1 data-testid="campus-analytics-heading" className="font-heading text-headline leading-tight text-foreground">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Throughput, waits and no-shows for the queues you manage. Times are campus time (IST).
          </p>
        </header>

        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-card sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1">
            <span id="analytics-range-heading" className="text-xs font-medium text-text-muted">Date range</span>
            <div
              className="inline-flex w-full rounded-md border border-border bg-secondary p-0.5 sm:w-auto"
              role="radiogroup"
              aria-labelledby="analytics-range-heading"
              data-testid="campus-analytics-window"
            >
              {RANGE_PRESETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={preset === option.id}
                  data-testid={`analytics-preset-${option.id}`}
                  onClick={() => choosePreset(option.id)}
                  className={cn(
                    "flex-1 rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:flex-none",
                    preset === option.id ? "bg-card text-foreground shadow-card" : "text-text-secondary hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {preset === "custom" ? (
            <form className="flex flex-wrap items-end gap-2" onSubmit={applyCustom} data-testid="analytics-custom-range" noValidate>
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                From
                <input
                  type="date"
                  className={selectClass}
                  value={draft.from}
                  max={today}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                  data-testid="analytics-from"
                  aria-invalid={Boolean(rangeError)}
                  aria-describedby={rangeError ? "analytics-range-error" : undefined}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                To
                <input
                  type="date"
                  className={selectClass}
                  value={draft.to}
                  max={today}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  data-testid="analytics-to"
                  aria-invalid={Boolean(rangeError)}
                  aria-describedby={rangeError ? "analytics-range-error" : undefined}
                />
              </label>
              <Button type="submit" size="sm" className="h-9" data-testid="analytics-apply">
                Apply
              </Button>
            </form>
          ) : null}

          <div className="flex flex-wrap items-end gap-2 sm:ml-auto">
            {!isStaffUser && venues.length > 1 ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                Venue
                <select
                  value={venueId}
                  onChange={(e) => {
                    setVenueId(e.target.value);
                    setQueueId("");
                  }}
                  data-testid="campus-analytics-venue"
                  className={selectClass}
                >
                  <option value="">All venues</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {queueOptions.length > 1 ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                Queue
                <select value={queueId} onChange={(e) => setQueueId(e.target.value)} data-testid="analytics-queue" className={selectClass}>
                  <option value="">All queues</option>
                  {queueOptions.map((q) => (
                    <option key={q.id} value={q.id}>{q.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {rangeError ? (
            <p id="analytics-range-error" role="alert" className="w-full text-sm text-destructive" data-testid="analytics-range-error">
              {rangeError}
            </p>
          ) : null}
        </div>

        {loading && !data ? (
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading analytics">
            <Skeleton className="h-24 rounded-lg" />
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-60 rounded-lg" />
              <Skeleton className="h-60 rounded-lg" />
            </div>
            <Skeleton className="h-40 rounded-lg" />
          </div>
        ) : null}

        {!loading && error ? (
          <Alert variant="destructive" data-testid="analytics-error" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span>We couldn&apos;t load analytics. {error}</span>
            <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </Button>
          </Alert>
        ) : null}

        {data && totals && !error ? (
          <div className={cn("flex flex-col gap-4 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
            <dl className="grid grid-cols-2 divide-border overflow-hidden rounded-lg border border-border bg-card shadow-card sm:grid-cols-4 sm:divide-x [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-border sm:[&>*:nth-child(n+3)]:border-t-0 [&>*:nth-child(even)]:border-l [&>*:nth-child(even)]:border-border sm:[&>*:nth-child(even)]:border-l-0">
              <Kpi
                label="Served"
                value={totals.served.toLocaleString("en-IN")}
                hint={`${totals.averageServedPerDay} per day`}
                testId="campus-analytics-served"
              />
              <Kpi
                label="Average wait"
                value={formatMinutes(totals.averageWaitMinutes)}
                hint={totals.p90WaitMinutes != null ? `90% within ${formatMinutes(totals.p90WaitMinutes)}` : "Join to call"}
                testId="campus-analytics-average-wait"
              />
              <Kpi
                label="No-show rate"
                value={formatRate(totals.noShowRate)}
                hint={`${totals.noShows} no-shows · ${totals.left} left`}
                testId="analytics-no-show-rate"
              />
              <Kpi
                label="Peak hour"
                value={totals.peakHour != null ? `${formatHour(totals.peakHour)}` : "—"}
                hint={totals.busiestDay ? `Busiest day ${formatShortDate(totals.busiestDay.date, year)}` : "No service yet"}
                testId="analytics-peak-hour"
              />
            </dl>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Served per day" subtitle={`${data.range.days} ${data.range.days === 1 ? "day" : "days"}`} testId="analytics-daily">
                <ColumnChart points={dailyPoints} testId="analytics-daily-chart" emptyText="No one was served in this range." />
                <SrTable
                  caption="Served per day"
                  headers={["Date", "Served", "No-shows", "Average wait"]}
                  rows={data.daily.map((d) => [d.date, d.served, d.noShows, formatMinutes(d.averageWaitMinutes)])}
                />
              </Panel>
              <Panel title="Peak hours" subtitle="Served by hour of day · IST" testId="analytics-hourly">
                <ColumnChart points={hourlyPoints} testId="analytics-hourly-chart" emptyText="No served tokens to chart yet." />
                <SrTable
                  caption="Served by hour of day"
                  headers={["Hour", "Served"]}
                  rows={data.hourly.map((h) => [formatHour(h.hour), h.served])}
                />
              </Panel>
            </div>

            <Panel title="By queue" subtitle="Wait is join to call. No-show rate is no-shows ÷ (served + no-shows)." testId="analytics-queues">
              {data.queues.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-text-muted">No queues in this scope.</p>
              ) : (
                <div
                  className="overflow-x-auto outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  tabIndex={0}
                  role="region"
                  aria-label="Queue breakdown table"
                >
                  <table className="w-full min-w-[560px] text-sm" data-testid="campus-analytics-queues">
                    <thead className="bg-secondary/60 text-left text-xs text-text-muted">
                      <tr>
                        <th scope="col" className="px-5 py-2 font-medium">Queue</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Served</th>
                        <th scope="col" className="px-3 py-2 font-medium">Average wait</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">90th pct</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">No-shows</th>
                        <th scope="col" className="px-5 py-2 text-right font-medium">No-show rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.queues.map((row) => (
                        <tr key={row.id} className="border-t border-border">
                          <th scope="row" className="px-5 py-2.5 text-left font-medium text-foreground">
                            {row.name}
                            {row.venue && !data.venue ? <span className="block text-xs font-normal text-text-muted">{row.venue}</span> : null}
                          </th>
                          <td className="px-3 py-2.5 text-right tabular-nums">{row.served}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="w-16 shrink-0 tabular-nums">{formatMinutes(row.averageWaitMinutes)}</span>
                              <span className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-secondary sm:block" aria-hidden="true">
                                <span
                                  className="block h-full rounded-full bg-primary/70"
                                  style={{ width: `${barPercent(row.averageWaitMinutes || 0, maxQueueWait)}%` }}
                                />
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatMinutes(row.p90WaitMinutes)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{row.noShows}</td>
                          <td className="px-5 py-2.5 text-right"><RateCell rate={row.noShowRate} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        ) : null}
      </ShellContent>
    </>
  );
}
