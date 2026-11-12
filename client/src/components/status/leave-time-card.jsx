import { Footprints } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCampusClockTime } from "@/lib/campus-time";
import { TRAVEL_CHOICES, leaveCopy, travelLabel } from "@/lib/leave-alert";

const TONE = {
  now: "border-warning-line bg-warning-soft",
  soon: "border-info/40 bg-info-soft",
  later: "border-border bg-card",
  paused: "border-border bg-card",
};

/**
 * "When to head over" — leave time from the live pace and the person's
 * own travel time. Travel time is a small radio group so it stays one tap.
 */
export function LeaveTimeCard({ leave, etaMinutes, travelMinutes, busy, error, onTravelChange, locale, t }) {
  if (!leave || !TONE[leave.state]) return null;
  const clock = leave.leaveAt ? formatCampusClockTime(leave.leaveAt, locale) : "";
  // The banner above the token carries the full "time to head over" line.
  const copy =
    leave.state === "now"
      ? { title: t("leave.nowCardTitle"), body: t("leave.nowCardBody") }
      : leaveCopy({ leave, etaMinutes, travelMinutes, clock, locale });
  const ink = leave.state === "now" ? "text-warning-ink" : leave.state === "soon" ? "text-info-ink" : "text-foreground";

  return (
    <section
      data-testid="leave-card"
      data-leave-state={leave.state}
      aria-labelledby="leave-card-title"
      className={cn("rounded-lg border px-4 py-3.5", TONE[leave.state])}
    >
      <p id="leave-card-title" className="text-label uppercase tracking-wide text-text-muted">
        {t("leave.cardTitle")}
      </p>
      {copy ? (
        <div className="mt-1.5" role="status" aria-live="polite">
          <p className={cn("font-heading text-base font-semibold", ink)} data-testid="leave-title">
            {copy.title}
          </p>
          <p className={cn("mt-0.5 text-sm", leave.state === "now" ? "text-warning-ink" : "text-text-secondary")}>
            {copy.body}
          </p>
        </div>
      ) : null}

      <fieldset className="mt-3" disabled={busy}>
        <legend className="text-sm font-medium text-foreground">{t("leave.travelLabel")}</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("leave.travelLabel")}>
          {TRAVEL_CHOICES.map((minutes) => {
            const selected = minutes === travelMinutes;
            return (
              <button
                key={minutes}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`travel-${minutes}`}
                onClick={() => !selected && onTravelChange(minutes)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-text-secondary hover:border-primary/50 hover:text-foreground"
                )}
              >
                {travelLabel(minutes, locale)}
              </button>
            );
          })}
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-text-muted">
          <Footprints className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("leave.travelHint")} {t("leave.pace")}</span>
        </p>
      </fieldset>
      {error ? (
        <p className="mt-2 text-sm text-danger-ink" role="alert" data-testid="leave-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Banner above the token when it's time to set off (position 2+). */
export function LeaveNowBanner({ etaMinutes, travelMinutes, locale }) {
  const copy = leaveCopy({ leave: { state: "now" }, etaMinutes, travelMinutes, locale });
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="leave-now-banner"
      className="flex items-start gap-2.5 rounded-lg border border-warning-line bg-warning-soft px-4 py-3"
    >
      <Footprints className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden="true" />
      <div>
        <p className="font-heading text-sm font-semibold text-warning-ink">{copy.title}</p>
        <p className="mt-0.5 text-xs leading-5 text-warning-ink">{copy.body}</p>
      </div>
    </div>
  );
}
