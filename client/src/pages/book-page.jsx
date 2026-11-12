import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CalendarClock, CalendarX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ShellContent } from "@/components/shell/shell-content";
import { useApp } from "@/context/app-context";
import { useI18n } from "@/context/i18n-context";
import { bookSlot, cancelBooking, checkInBooking, fetchSlots } from "@/api";
import { checkInState, formatBookingDay, formatSlotTime, groupSlots } from "@/lib/appointments";
import { formatCampusDateTime } from "@/lib/campus-time";
import { cn } from "@/lib/utils";

/**
 * Book a time at a queue: pick a campus day, pick an open slot, confirm.
 * Your booking sits on top with check-in (when open) and cancel.
 */
export function BookPage() {
  const { queueId } = useParams();
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const { token, isGuest, adoptMembership } = useApp();
  const [date, setDate] = useState(null);
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(
    async (nextDate) => {
      setLoading(true);
      setLoadError("");
      try {
        const data = await fetchSlots(token || null, queueId, nextDate);
        setGrid(data);
        setDate(data.date);
      } catch (err) {
        setLoadError(err.message || "");
      } finally {
        setLoading(false);
      }
    },
    [token, queueId]
  );

  useEffect(() => {
    load(null);
  }, [load]);

  async function run(fn, okNotice) {
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const result = await fn();
      if (okNotice) setNotice(okNotice);
      return result;
    } catch (err) {
      setActionError(err.message || t("book.failed"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleBook() {
    if (!picked) return;
    const ok = await run(() => bookSlot(token, queueId, picked), t("book.confirmed", { time: formatSlotTime(picked, locale) }));
    setPicked(null);
    await load(date);
    return ok;
  }

  async function handleCancel() {
    if (!grid?.booking) return;
    await run(() => cancelBooking(token, queueId, grid.booking.id), t("book.cancelled"));
    await load(date);
  }

  async function handleCheckIn() {
    if (!grid?.booking) return;
    const status = await run(() => checkInBooking(token, queueId, grid.booking.id));
    if (status) {
      adoptMembership(status);
      navigate("/status");
    } else {
      await load(date);
    }
  }

  const booking = grid?.booking || null;
  const state = checkInState(booking, now);
  const queueName = grid?.queue?.name || t("common.queue");
  const groups = groupSlots(grid?.slots || []);

  return (
    <ShellContent tier="student">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          <Link to="/queues" className="hover:text-foreground hover:underline">{t("nav.queues")}</Link>
        </p>
        <h1 className="font-heading text-headline leading-tight text-foreground" data-testid="book-heading">
          {t("book.title", { name: queueName })}
        </h1>
        {grid?.enabled ? (
          <p className="mt-1 text-sm text-text-secondary">
            {t("book.intro", { minutes: grid.slotMinutes, grace: grid.graceMinutes })}
          </p>
        ) : null}
      </header>

      {isGuest ? (
        <Alert className="mb-5" data-testid="book-sign-in">
          {t("book.signIn")}{" "}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("auth.login")}
          </Link>
        </Alert>
      ) : null}

      {booking ? (
        <section
          className="mb-6 rounded-md border border-primary/40 bg-primary-muted/50 px-5 py-4 shadow-card"
          aria-labelledby="my-booking-title"
          data-testid="my-booking"
        >
          <h2 id="my-booking-title" className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t("book.yours")}
          </h2>
          <p className="mt-1 font-heading text-title text-foreground" data-testid="my-booking-time">
            {formatCampusDateTime(booking.slotStart, locale)}
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {state === "early"
              ? t("book.checkInFrom", { time: formatSlotTime(booking.checkInOpensAt, locale) })
              : state === "open"
                ? t("book.checkInOpen", { time: formatSlotTime(booking.checkInClosesAt, locale) })
                : state === "in-line"
                  ? t("book.inLine", { token: booking.tokenNumber ?? "—" })
                  : t("book.checkInClosed")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state === "open" ? (
              <Button onClick={handleCheckIn} disabled={busy} data-testid="booking-check-in">
                {t("book.checkIn")}
              </Button>
            ) : null}
            {state === "in-line" ? (
              <Button onClick={() => navigate("/status")} data-testid="booking-view-place">
                {t("book.viewPlace")}
              </Button>
            ) : null}
            {booking.status === "booked" ? (
              <Button variant="outline" onClick={handleCancel} disabled={busy} data-testid="booking-cancel">
                {t("book.cancel")}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {notice ? (
        <p role="status" className="mb-4 text-sm font-medium text-primary" data-testid="book-notice">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <Alert variant="destructive" className="mb-4" data-testid="book-error">
          {actionError}
        </Alert>
      ) : null}

      {loadError ? (
        <ErrorState
          testId="book-load-error"
          title={t("book.loadFailed")}
          message={t("error.connection")}
          detail={loadError}
          retryLabel={t("error.retry")}
          onRetry={() => load(date)}
        />
      ) : null}

      {!loadError && grid && !grid.enabled ? (
        <EmptyState
          icon={CalendarX}
          testId="book-disabled"
          title={t("book.disabled")}
          hint={t("book.disabledHint")}
          action={
            <Button variant="secondary" onClick={() => navigate("/queues")}>
              {t("book.backToQueues")}
            </Button>
          }
        />
      ) : null}

      {!loadError && grid?.enabled ? (
        <>
          <div
            role="tablist"
            aria-label={t("book.dayLabel")}
            className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1"
            data-testid="book-days"
          >
            {grid.dates.map((day) => (
              <button
                key={day}
                type="button"
                role="tab"
                aria-selected={day === date}
                onClick={() => {
                  setPicked(null);
                  load(day);
                }}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  day === date
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-text-secondary hover:bg-secondary"
                )}
                data-testid="book-day"
              >
                {formatBookingDay(day, locale)}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="h-14 rounded-md" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              testId="book-no-slots"
              title={t("book.noSlots")}
              hint={t("book.noSlotsHint")}
            />
          ) : (
            <div className={cn("flex flex-col gap-5", booking && "opacity-60")} data-testid="book-slots">
              {booking ? <p className="text-sm text-text-secondary">{t("book.oneAtATime")}</p> : null}
              {groups.map((group) => (
                <fieldset key={group.key} disabled={busy || isGuest || Boolean(booking)}>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {t(`book.part.${group.key}`)}
                  </legend>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {group.slots.map((slot) => {
                      const open = slot.state === "open";
                      const selected = picked === slot.start;
                      const label = formatSlotTime(slot.start, locale);
                      const sub =
                        slot.state === "past"
                          ? t("book.slotPast")
                          : slot.state === "full"
                            ? t("book.slotFull")
                            : t("book.slotLeft", { count: slot.available });
                      return (
                        <button
                          key={slot.start}
                          type="button"
                          disabled={!open}
                          aria-pressed={selected}
                          aria-label={`${label}, ${sub}`}
                          onClick={() => setPicked(selected ? null : slot.start)}
                          className={cn(
                            "flex flex-col items-center rounded-md border px-2 py-2 text-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : open
                                ? "border-border bg-card hover:border-primary/60 hover:bg-primary-muted/40"
                                : "border-border bg-secondary/50 text-text-muted"
                          )}
                          data-testid="book-slot"
                          data-state={slot.state}
                        >
                          <span className="font-metric text-sm font-semibold tabular-nums">{label}</span>
                          <span className={cn("text-xs", selected ? "text-primary-foreground/90" : "text-text-muted")}>
                            {sub}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          )}

          {!booking && !isGuest ? (
            <div className="mt-6 flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-text-secondary" aria-live="polite">
                {picked ? t("book.picked", { time: formatSlotTime(picked, locale) }) : t("book.pickHint")}
              </p>
              <Button size="lg" onClick={handleBook} disabled={!picked || busy} data-testid="book-confirm">
                {busy ? t("book.booking") : t("book.confirm")}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {!grid && loading && !loadError ? <Skeleton className="h-40 rounded-md" /> : null}
    </ShellContent>
  );
}
