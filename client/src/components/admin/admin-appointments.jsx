import { useCallback, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { adminCheckInAppointment, fetchQueueAppointments } from "@/api";
import { formatSlotTime } from "@/lib/appointments";
import { cn } from "@/lib/utils";

const STATUS_LABEL = {
  booked: "Booked",
  "checked-in": "Checked in",
  missed: "Missed",
};

const STATUS_CLASS = {
  booked: "bg-info-soft text-info-ink",
  "checked-in": "bg-primary-muted text-primary",
  missed: "bg-warning-soft text-warning-ink",
};

/**
 * Today's bookings for the console: who is due when, and a desk check-in
 * for people who arrive without the app. Refreshes when the line changes.
 */
export function AdminAppointments({ token, queueId, refreshKey, onCheckedIn }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!token || !queueId) return;
    try {
      setData(await fetchQueueAppointments(token, queueId));
      setNow(Date.now());
      setError("");
    } catch (err) {
      setError(err.message || "Could not load bookings");
    }
  }, [token, queueId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function checkIn(row) {
    setBusyId(row.id);
    setError("");
    try {
      await adminCheckInAppointment(token, queueId, row.id);
      await load();
      onCheckedIn?.();
    } catch (err) {
      setError(err.message || "Could not check in");
    } finally {
      setBusyId(null);
    }
  }

  if (!data?.enabled && !(data?.appointments?.length > 0)) return null;
  const rows = data?.appointments || [];

  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card px-5 py-5 shadow-card"
      aria-labelledby="admin-bookings-title"
      data-testid="admin-bookings"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="admin-bookings-title" className="text-label uppercase tracking-wide text-text-muted">
          Bookings today
        </h2>
        <span className="text-xs text-text-muted">
          {data.slotMinutes}-min slots · {data.slotCapacity} per slot · {data.graceMinutes}-min grace
        </span>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger-ink">
          {error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          className="mt-3 py-6"
          title="No bookings today"
          hint="People can book from the queue list. Booked turns alternate with walk-ins."
          testId="admin-bookings-empty"
        />
      ) : (
        <ul className="mt-3 divide-y divide-border" data-testid="admin-bookings-list">
          {rows.map((row) => {
            const canCheckIn = row.status === "booked" && new Date(row.checkInClosesAt).getTime() >= now;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5" data-testid="admin-booking-row">
                <span className="w-20 font-metric text-sm font-semibold tabular-nums text-foreground">
                  {formatSlotTime(row.slotStart)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {row.user?.name || row.user?.email || "Booked user"}
                  {row.tokenNumber ? <span className="text-text-muted"> · #{row.tokenNumber}</span> : null}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    STATUS_CLASS[row.status] || "bg-secondary text-text-secondary"
                  )}
                >
                  {STATUS_LABEL[row.status] || row.status}
                </span>
                {canCheckIn ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => checkIn(row)}
                    disabled={busyId === row.id}
                    data-testid="admin-booking-check-in"
                    aria-label={`Check in ${row.user?.name || "booking"} for ${formatSlotTime(row.slotStart)}`}
                  >
                    Check in
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
