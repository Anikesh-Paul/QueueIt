import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { useApp } from "@/context/app-context";
import { PageToolbar } from "@/components/shell/page-toolbar";
import { ShellContent } from "@/components/shell/shell-content";
import { fetchCampusAnalytics, downloadCampusAnalyticsCsv, fetchAdminCatalog } from "@/api";
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
      <span data-testid={testId} className="font-metric text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

/**
 * Campus (or venue) analytics rollup with CSV export for the selected window.
 * Staff are locked to their venue; global admins can filter.
 */
export function CampusAnalyticsPage() {
  const navigate = useNavigate();
  const { token, user, isAdmin } = useApp();
  const [analyticsWindow, setAnalyticsWindow] = useState("today");
  const [venueId, setVenueId] = useState("");
  const [venues, setVenues] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const isStaffUser = user?.role === "staff";

  useEffect(() => {
    if (!token) return;
    fetchAdminCatalog(token)
      .then((payload) => setVenues(payload.venues || []))
      .catch(() => setVenues([]));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchCampusAnalytics(token, {
      window: analyticsWindow,
      ...(venueId ? { venueId } : {}),
    })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
          setError(err.message || "Could not load campus analytics");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, analyticsWindow, venueId]);

  const metrics = data?.metrics || null;
  const peakHours = data?.peakHours || [];
  const maxServed = Math.max(1, ...peakHours.map((hour) => hour.served));
  const title = useMemo(() => {
    if (data?.venue?.name) return data.venue.name;
    return "All venues";
  }, [data]);

  async function handleExport() {
    if (!token || exporting) return;
    setExporting(true);
    setError("");
    try {
      await downloadCampusAnalyticsCsv(token, {
        window: analyticsWindow,
        ...(venueId ? { venueId } : {}),
      });
    } catch (err) {
      setError(err.message || "Could not export CSV");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageToolbar
        tier="admin"
        title={<span data-testid="campus-analytics-scope">{title}</span>}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={loading || exporting || !metrics}
              data-testid="campus-analytics-export"
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/admin/catalog")}
              data-testid="campus-analytics-back"
            >
              Back to catalog
            </Button>
          </>
        }
      />

      <ShellContent tier="admin">
        <header className="mb-6">
          <h1
            data-testid="campus-analytics-heading"
            className="font-heading text-headline leading-tight text-foreground"
          >
            Campus analytics
          </h1>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="flex flex-wrap gap-2" data-testid="campus-analytics-window" role="tablist" aria-label="Analytics range">
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
                  data-testid={`campus-analytics-window-${option.id}`}
                  onClick={() => setAnalyticsWindow(option.id)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {isAdmin && !isStaffUser && venues.length > 0 ? (
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                Venue
                <select
                  value={venueId}
                  onChange={(event) => setVenueId(event.target.value)}
                  data-testid="campus-analytics-venue"
                  className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">All venues</option>
                  {venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </header>

        {loading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy="true">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        )}

        {!loading && error ? <Alert variant="destructive">{error}</Alert> : null}

        {!loading && !error && metrics ? (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Served" value={metrics.servedCount} testId="campus-analytics-served" hero />
              <MetricCard label="Average wait" value={formatMinutes(metrics.averageWaitMinutes)} testId="campus-analytics-average-wait" />
              <MetricCard label="Longest wait" value={formatMinutes(metrics.longestWaitMinutes)} testId="campus-analytics-longest-wait" />
              <MetricCard label="Waiting now" value={metrics.waitingCount} testId="campus-analytics-waiting" />
            </section>

            <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-card">
              <div className="border-b border-border px-5 py-4">
                <p className="font-heading text-sm font-semibold text-foreground">Busiest hours</p>
                <p className="mt-0.5 text-xs text-text-muted">Campus time · IST</p>
              </div>
              <div className="px-5 py-5">
                {metrics.servedCount === 0 ? (
                  <p className="text-sm text-text-muted" data-testid="campus-analytics-peak-empty">
                    No served tokens yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-4" data-testid="campus-analytics-peak-hours">
                    {peakHours.map((hour) => (
                      <li key={hour.label} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium text-foreground">{hour.label}</span>
                          <span className="tabular-nums text-text-secondary">{hour.served} served</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(8, (hour.served / maxServed) * 100)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-card">
              <div className="border-b border-border px-5 py-4">
                <p className="font-heading text-sm font-semibold text-foreground">By queue</p>
              </div>
              <ul className="flex flex-col sm:hidden" data-testid="campus-analytics-queues">
                {(data.queues || []).map((row) => (
                  <li key={row.id} className="border-t border-border px-5 py-3 first:border-t-0">
                    <p className="font-medium text-foreground">{row.name}</p>
                    <p className="text-xs text-text-secondary">{row.venue || "—"}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      <span className="tabular-nums text-foreground">{row.servedCount}</span> served
                      {" · "}
                      <span className="tabular-nums text-foreground">{row.waitingCount}</span> waiting
                      {" · "}
                      <span className="tabular-nums text-foreground">{formatMinutes(row.averageWaitMinutes)}</span> avg
                    </p>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-text-muted">
                    <tr>
                      <th className="px-5 py-2 font-medium">Queue</th>
                      <th className="px-5 py-2 font-medium">Venue</th>
                      <th className="px-5 py-2 font-medium">Served</th>
                      <th className="px-5 py-2 font-medium">Waiting</th>
                      <th className="px-5 py-2 font-medium">Avg wait</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.queues || []).map((row) => (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-5 py-2.5 font-medium text-foreground">{row.name}</td>
                        <td className="px-5 py-2.5 text-text-secondary">{row.venue || "—"}</td>
                        <td className="px-5 py-2.5 tabular-nums">{row.servedCount}</td>
                        <td className="px-5 py-2.5 tabular-nums">{row.waitingCount}</td>
                        <td className="px-5 py-2.5 tabular-nums">{formatMinutes(row.averageWaitMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </ShellContent>
    </>
  );
}
