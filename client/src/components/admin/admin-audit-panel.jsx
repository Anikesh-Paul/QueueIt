import { useEffect, useState } from "react";
import { fetchAdminAudit } from "@/api";
import { formatCampusDateTime } from "@/lib/campus-time";
import { auditActionLabel, auditMetaLine } from "@/lib/admin-audit";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Recent operator actions for this queue (campus IST timestamps).
 */
export function AdminAuditPanel({ token, queueId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token || !queueId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchAdminAudit(token, { queueId, limit: 20 })
      .then((payload) => {
        if (!cancelled) setEvents(payload.events || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Could not load activity");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, queueId]);

  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card px-5 py-5 shadow-card"
      data-testid="admin-audit-panel"
    >
      <h2 className="text-label uppercase tracking-wide text-text-muted">Activity</h2>
      <p className="mt-1 text-xs text-text-secondary">Recent admin actions · campus time (IST)</p>

      {loading ? (
        <div className="mt-3 flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      ) : null}

      {!loading && error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : null}

      {!loading && !error && events.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted" data-testid="admin-audit-empty">
          No recorded actions yet.
        </p>
      ) : null}

      {!loading && events.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2" data-testid="admin-audit-list">
          {events.map((event) => {
            const meta = auditMetaLine(event);
            return (
              <li
                key={event.id}
                data-testid="admin-audit-event"
                data-action={event.action}
                className="rounded-md border border-border bg-secondary px-3.5 py-2.5"
              >
                <p className="text-sm font-medium text-foreground">{auditActionLabel(event.action)}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {event.actor?.name || event.actor?.email || "Admin"}
                  {event.createdAt ? ` · ${formatCampusDateTime(event.createdAt)}` : ""}
                  {meta ? ` · ${meta}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
