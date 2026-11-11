import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { useApp } from "@/context/app-context";
import { PageToolbar } from "@/components/shell/page-toolbar";
import { ShellContent } from "@/components/shell/shell-content";
import { cn } from "@/lib/utils";

function formatMinutes(value) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(1)} min`;
}

function MetricCard({ label, value, testId, hero = false }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-4 py-3",
        hero ? "border-primary/30 bg-primary-muted/40" : "border-border bg-secondary"
      )}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</span>
      <span
        data-testid={testId}
        className="font-metric text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground"
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Admin ops analytics for one queue: served count, average wait, and simple
 * peaks (busiest hours). Defaults to today's campus IST window; All time is
 * one click away. Numeric-first storytelling — no chart library, no
 * BI claims; refresh is manual + on mount. No motif wallpaper on empty.
 * Ruthless chrome: **Analytics** / **Busiest hours** / **Campus time · IST**.
 */
export function AnalyticsPage() {
  const { queueId } = useParams();
  const navigate = useNavigate();
  const { token, analyticsData, analyticsLoading, analyticsError, loadAnalytics } = useApp();
  const [analyticsWindow, setAnalyticsWindow] = useState("today");

  useEffect(() => {
    if (queueId && token) loadAnalytics(token, queueId, { window: analyticsWindow });
  }, [queueId, token, loadAnalytics, analyticsWindow]);

  const queueName = analyticsData?.queue?.name || "Queue";
  const metrics = analyticsData?.metrics || null;
  const peakHours = analyticsData?.peakHours || [];
  const servedCount = metrics?.servedCount ?? 0;
  const maxServed = Math.max(1, ...peakHours.map((hour) => hour.served));

  return (
    <>
      <PageToolbar
        tier="admin"
        title={<span data-testid="analytics-queue-name">{queueName}</span>}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadAnalytics(token, queueId, { window: analyticsWindow })}
              disabled={analyticsLoading}
              data-testid="analytics-refresh"
            >
              {analyticsLoading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/admin/queues/${queueId}`)}
              data-testid="back-to-console"
            >
              Back to console
            </Button>
          </>
        }
      />

      <ShellContent tier="admin">
        <header className="mb-6">
          <h1
            data-testid="analytics-heading"
            className="font-heading text-headline leading-tight text-foreground"
          >
            Analytics
          </h1>
          <div className="mt-3 flex flex-wrap gap-2" data-testid="analytics-window" role="tablist" aria-label="Analytics range">
            {[
              { id: "today", label: "Today" },
              { id: "all", label: "All time" },
            ].map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={analyticsWindow === option.id ? "default" : "secondary"}
                aria-selected={analyticsWindow === option.id}
                role="tab"
                data-testid={`analytics-window-${option.id}`}
                onClick={() => setAnalyticsWindow(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </header>

        {analyticsLoading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy="true">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        )}

        {!analyticsLoading && analyticsError && (
          <Alert variant="destructive">{analyticsError}</Alert>
        )}

        {!analyticsLoading && !analyticsError && metrics && (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard
                label="Served"
                value={servedCount}
                testId="analytics-served"
                hero
              />
              <MetricCard
                label="Average wait"
                value={formatMinutes(metrics.averageWaitMinutes)}
                testId="analytics-average-wait"
              />
              <MetricCard
                label="Longest wait"
                value={formatMinutes(metrics.longestWaitMinutes)}
                testId="analytics-longest-wait"
              />
              <MetricCard
                label="Waiting now"
                value={metrics.waitingCount}
                testId="analytics-waiting"
              />
            </section>

            <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-card">
              <div className="border-b border-border px-5 py-4">
                <p className="font-heading text-sm font-semibold text-foreground">
                  Busiest hours
                </p>
                <p
                  className="mt-0.5 text-xs text-text-muted"
                  data-testid="analytics-campus-time"
                >
                  Campus time · IST
                </p>
              </div>
              <div className="px-5 py-5">
                {servedCount === 0 ? (
                  <p
                    className="text-sm text-text-muted"
                    data-testid="analytics-peak-empty"
                  >
                    No served tokens yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-4" data-testid="analytics-peak-hours">
                    {peakHours.map((hour) => (
                      <li
                        key={hour.label}
                        data-testid="analytics-peak-hour"
                        data-label={hour.label}
                        data-served={hour.served}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-medium text-foreground">
                            {hour.label}
                          </span>
                          <span className="text-xs tabular-nums text-text-muted">
                            {hour.served} served
                          </span>
                        </div>
                        <div
                          className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary"
                          role="img"
                          aria-label={`${hour.label}: ${hour.served} served`}
                        >
                          <div
                            className={cn(
                              "h-full rounded-full",
                              hour.served === maxServed ? "bg-primary" : "bg-primary/40"
                            )}
                            style={{ width: `${(hour.served / maxServed) * 100}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <BusynessChart busyness={analyticsData?.busyness} />
          </>
        )}
      </ShellContent>
    </>
  );
}


const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function BusynessChart({ busyness }) {
  const days = Array.isArray(busyness?.days) ? busyness.days : [];
  const total = busyness?.total ?? 0;
  const hint = busyness?.quietHint;
  const max = Math.max(1, ...days.flatMap((day) => day.hours || []));

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="border-b border-border px-5 py-4">
        <p className="font-heading text-sm font-semibold text-foreground">Usual busyness</p>
        <p className="mt-0.5 text-xs text-text-muted" data-testid="analytics-busyness-caption">
          Joins in the last 60 days · campus time (IST)
        </p>
      </div>
      <div className="px-5 py-5">
        {total === 0 ? (
          <p className="text-sm text-text-muted" data-testid="analytics-busyness-empty">
            Not enough history yet
          </p>
        ) : (
          <>
            {hint?.label ? (
              <p className="mb-3 text-sm font-medium text-foreground" data-testid="analytics-quiet-hint">
                Usually quiet around {hint.label}
              </p>
            ) : (
              <p className="mb-3 text-sm text-text-muted" data-testid="analytics-busyness-low">
                Not enough history yet to name a quiet hour
              </p>
            )}
            <div className="overflow-x-auto" data-testid="analytics-busyness-chart">
              <div className="inline-grid grid-cols-[auto_repeat(24,minmax(0.55rem,1fr))] gap-0.5">
                <span />
                {Array.from({ length: 24 }, (_, hour) => (
                  <span
                    key={hour}
                    className="text-center text-[9px] text-text-muted"
                  >
                    {hour % 3 === 0 ? hour : ""}
                  </span>
                ))}
                {days.map((day) => (
                  <div key={day.weekday} className="contents">
                    <span className="pr-2 text-xs text-text-secondary">
                      {day.label || WEEKDAY_LABELS[day.weekday]}
                    </span>
                    {(day.hours || []).map((count, hour) => {
                      const intensity = count === 0 ? 0 : 0.18 + (count / max) * 0.82;
                      return (
                        <span
                          key={`${day.weekday}-${hour}`}
                          title={`${day.label || WEEKDAY_LABELS[day.weekday]} ${hour}:00 · ${count}`}
                          data-testid="busyness-cell"
                          data-weekday={day.weekday}
                          data-hour={hour}
                          data-count={count}
                          className="h-3.5 w-3.5 rounded-sm ring-1 ring-black/5"
                          style={{
                            backgroundColor:
                              count === 0
                                ? "var(--color-secondary, #f1f5f4)"
                                : `color-mix(in srgb, var(--color-primary, #1f4d3a) ${Math.round(intensity * 100)}%, #edf3f0)`,
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
