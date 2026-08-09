import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { useApp } from "@/context/app-context";
import { cn } from "@/lib/utils";

function formatMinutes(value) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(1)} min`;
}

function MetricCard({ label, caption, value, testId, hero = false, valueClassName }) {
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
        className={cn(
          "font-heading text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground",
          valueClassName
        )}
      >
        {value}
      </span>
      <span className="text-xs text-text-muted">{caption}</span>
    </div>
  );
}

/**
 * Admin ops analytics for one queue: served count, average wait, and simple
 * peaks (busiest hours). Numeric-first storytelling — no chart library, no
 * BI claims; refresh is manual + on mount.
 */
export function AnalyticsPage() {
  const { queueId } = useParams();
  const navigate = useNavigate();
  const { token, analyticsData, analyticsLoading, analyticsError, loadAnalytics } = useApp();

  useEffect(() => {
    if (queueId && token) loadAnalytics(token, queueId);
  }, [queueId, token, loadAnalytics]);

  const queueName = analyticsData?.queue?.name || "Queue";
  const metrics = analyticsData?.metrics || null;
  const peakHours = analyticsData?.peakHours || [];
  const servedCount = metrics?.servedCount ?? 0;
  const maxServed = Math.max(1, ...peakHours.map((hour) => hour.served));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-display leading-tight text-foreground">
            Queue analytics
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {queueName} — served count, average wait, and busy hours. Enough for
            ops storytelling, not a BI tool.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadAnalytics(token, queueId)}
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

      {!analyticsLoading && analyticsError && <Alert variant="destructive">{analyticsError}</Alert>}

      {!analyticsLoading && !analyticsError && metrics && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="Served"
              caption="tokens completed"
              value={servedCount}
              testId="analytics-served"
              hero
            />
            <MetricCard
              label="Average wait"
              caption="per served token"
              value={formatMinutes(metrics.averageWaitMinutes)}
              testId="analytics-average-wait"
            />
            <MetricCard
              label="Longest wait"
              caption="of any served token"
              value={formatMinutes(metrics.longestWaitMinutes)}
              testId="analytics-longest-wait"
            />
            <MetricCard
              label="Waiting now"
              caption="in line right now"
              value={metrics.waitingCount}
              testId="analytics-waiting"
            />
          </section>

          <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <div className="border-b border-border px-5 py-4">
              <p className="font-heading text-sm font-semibold text-foreground">Busiest hours</p>
              <p className="mt-0.5 text-xs text-text-muted">
                Top serving hours by tokens completed (UTC) — a simple throughput peak.
              </p>
            </div>
            <div className="px-5 py-5">
              {servedCount === 0 ? (
                <p
                  className="text-sm text-text-muted"
                  data-testid="analytics-peak-empty"
                >
                  No served tokens yet — serve someone and the busiest hour shows up here.
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
                        <span className="text-sm font-medium text-foreground">{hour.label}</span>
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

          <p className="mt-4 text-xs text-text-muted">
            Wait = time from joining until served. Stats are cumulative over the
            queue's history — served entries are kept even after a queue reset.
          </p>
        </>
      )}
    </div>
  );
}
