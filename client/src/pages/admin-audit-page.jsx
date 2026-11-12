import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { PageToolbar } from "@/components/shell/page-toolbar";
import { ShellContent } from "@/components/shell/shell-content";
import { useApp } from "@/context/app-context";
import { downloadAuditCsv, fetchAdminAudit, fetchAdminCatalog, fetchAuditActors } from "@/api";
import {
  AUDIT_CATEGORIES,
  auditActionLabel,
  auditActorLabel,
  auditMetaLine,
  auditQueryString,
  groupAuditByDay,
} from "@/lib/admin-audit";
import { formatCampusClockTime } from "@/lib/campus-time";
import { cn } from "@/lib/utils";

const PAGE = 30;
const FILTER_KEYS = ["category", "actorId", "queueId", "from", "to"];
const SELECT =
  "mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function readFilters(params) {
  const out = {};
  for (const key of FILTER_KEYS) out[key] = params.get(key) || "";
  return out;
}

/**
 * Full audit log: every recorded staff action I can see, filterable by kind,
 * person, queue and IST day range, with CSV export.
 */
export function AdminAuditPage() {
  const { token } = useApp();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const [events, setEvents] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [actors, setActors] = useState([]);
  const [venues, setVenues] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    if (!token) return;
    fetchAuditActors(token)
      .then((data) => setActors(data.actors || []))
      .catch(() => setActors([]));
    fetchAdminCatalog(token)
      .then((data) => setVenues(Array.isArray(data.venues) ? data.venues : []))
      .catch(() => setVenues([]));
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    setExportNote("");
    try {
      const data = await fetchAdminAudit(token, { ...filters, limit: PAGE });
      if (id !== requestId.current) return;
      setEvents(data.events || []);
      setCursor(data.hasMore ? data.cursor : null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err.message || "Couldn't load the audit log");
      setEvents(null);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [token, filters]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchAdminAudit(token, { ...filters, limit: PAGE, cursor });
      setEvents((prev) => [...(prev || []), ...(data.events || [])]);
      setCursor(data.hasMore ? data.cursor : null);
    } catch (err) {
      setError(err.message || "Couldn't load more");
    } finally {
      setLoadingMore(false);
    }
  }

  function setFilter(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  async function exportCsv() {
    setExporting(true);
    setExportNote("");
    try {
      const rows = await downloadAuditCsv(token, auditQueryString(filters));
      setExportNote(rows >= 5000 ? "Downloaded the newest 5,000 entries. Narrow the dates for the rest." : `Downloaded ${rows} entr${rows === 1 ? "y" : "ies"}.`);
    } catch (err) {
      setExportNote(err.message || "Couldn't export");
    } finally {
      setExporting(false);
    }
  }

  const groups = useMemo(() => groupAuditByDay(events || []), [events]);
  const hasFilters = FILTER_KEYS.some((k) => filters[k]);

  return (
    <>
      <PageToolbar
        tier="admin"
        title="Audit log"
        meta="Campus time (IST) · kept for 90 days"
        actions={
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={exporting || loading} data-testid="audit-export">
            <Download className="size-4" aria-hidden="true" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        }
      />
      <ShellContent tier="admin">
        <header className="mb-5">
          <h1 className="font-heading text-headline leading-tight text-foreground" data-testid="audit-heading">
            Audit log
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Who changed what, and when. Covers every queue and venue you manage.
          </p>
        </header>

        <section
          aria-label="Filters"
          className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-card lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] lg:items-end"
        >
          <div>
            <Label htmlFor="audit-kind">Kind</Label>
            <select id="audit-kind" className={SELECT} value={filters.category} onChange={(e) => setFilter("category", e.target.value)} data-testid="audit-filter-kind">
              <option value="">All actions</option>
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="audit-who">Who</Label>
            <select id="audit-who" className={SELECT} value={filters.actorId} onChange={(e) => setFilter("actorId", e.target.value)} data-testid="audit-filter-who">
              <option value="">Everyone</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {auditActorLabel(a)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 lg:col-span-1">
            <Label htmlFor="audit-queue">Queue</Label>
            <select id="audit-queue" className={SELECT} value={filters.queueId} onChange={(e) => setFilter("queueId", e.target.value)} data-testid="audit-filter-queue">
              <option value="">All queues</option>
              {venues.map((v) => (
                <optgroup key={v.id} label={v.name}>
                  {(v.queues || []).map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                      {q.archived ? " (archived)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="audit-from">From</Label>
            <input id="audit-from" type="date" className={SELECT} value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter("from", e.target.value)} data-testid="audit-filter-from" />
          </div>
          <div>
            <Label htmlFor="audit-to">To</Label>
            <input id="audit-to" type="date" className={SELECT} value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter("to", e.target.value)} data-testid="audit-filter-to" />
          </div>
          <div className="col-span-2 lg:col-span-1">
            <Button variant="ghost" size="sm" className="h-9" disabled={!hasFilters} onClick={() => setParams(new URLSearchParams(), { replace: true })} data-testid="audit-clear">
              Clear
            </Button>
          </div>
        </section>

        {exportNote ? (
          <p role="status" className="mb-3 text-sm text-text-secondary" data-testid="audit-export-note">
            {exportNote}
          </p>
        ) : null}

        {loading && !events ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading audit log">
            <Skeleton className="h-14 rounded-lg" />
            <Skeleton className="h-14 rounded-lg" />
            <Skeleton className="h-14 rounded-lg" />
          </div>
        ) : null}

        {error && !events ? (
          <ErrorState testId="audit-error" title="Couldn't load the audit log" message={error} retryLabel="Try again" onRetry={load} />
        ) : null}

        {events && events.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-5 py-10 text-center text-sm text-text-muted" data-testid="audit-empty">
            {hasFilters ? "Nothing matches these filters." : "No recorded actions yet."}
          </p>
        ) : null}

        {events && events.length > 0 ? (
          <div className={cn("flex flex-col gap-4", loading && "opacity-60")} aria-busy={loading || undefined}>
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`audit-day-${group.key}`} className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
                <h2 id={`audit-day-${group.key}`} className="border-b border-border px-5 py-2.5 text-sm font-semibold text-foreground">
                  {group.label}
                  <span className="ml-2 font-normal text-text-muted">{group.events.length}</span>
                </h2>
                <ol className="divide-y divide-border" data-testid="audit-list">
                  {group.events.map((event) => {
                    const meta = auditMetaLine(event);
                    const where = [event.queue?.name, event.venue?.name].filter(Boolean).join(" · ");
                    return (
                      <li key={event.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 px-5 py-3 sm:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,14rem)]" data-testid="audit-row" data-action={event.action}>
                        <time dateTime={event.createdAt} className="pt-px text-xs tabular-nums text-text-muted">
                          {formatCampusClockTime(event.createdAt).replace(" IST", "")}
                        </time>
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">
                            <span className="font-medium">{auditActorLabel(event.actor)}</span>{" "}
                            <span className="text-text-secondary">{auditActionLabel(event.action).replace(/^./, (c) => c.toLowerCase())}</span>
                          </p>
                          {meta ? <p className="mt-0.5 break-words text-xs text-text-muted">{meta}</p> : null}
                          {where ? <p className="mt-0.5 text-xs text-text-muted sm:hidden">{where}</p> : null}
                        </div>
                        <p className="hidden truncate text-right text-xs text-text-muted sm:block" title={where || undefined}>
                          {where || "Campus-wide"}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
            {cursor ? (
              <Button variant="secondary" className="self-center" onClick={loadMore} disabled={loadingMore} data-testid="audit-more">
                {loadingMore ? "Loading…" : "Load older entries"}
              </Button>
            ) : (
              <p className="text-center text-xs text-text-muted">That&apos;s everything for these filters.</p>
            )}
          </div>
        ) : null}
      </ShellContent>
    </>
  );
}
