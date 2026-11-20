import { useId, useState } from "react";
import { CalendarClock, Hourglass, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/context/i18n-context";
import { useBestTime } from "@/hooks/use-best-time";
import { cn } from "@/lib/utils";
import {
  WEEKDAYS,
  badgeClass,
  barHeights,
  busiestHour,
  campusWeekday,
  hourLabel,
  levelColor,
  levelKey,
  nowBadge,
  recommendedHour,
  visibleHours,
  weekdayName,
} from "@/lib/best-time";

const CHART_H = 120;
const BAR_AREA = 96;

export function NowBadge({ now, className, testId = "best-time-now" }) {
  const { t } = useI18n();
  const badge = nowBadge(now);
  if (!badge) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", badgeClass(badge.tone), className)}
      data-testid={testId}
      data-level={badge.tone}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {t(badge.key)}
    </span>
  );
}

/** Lightweight SVG bars (crowd) + line (typical wait). Decorative; the text and table carry the data. */
function Chart({ hours, bestHour, currentHour, locale, labelledBy }) {
  const n = hours.length;
  const slot = 100 / n;
  const heights = barHeights(hours, BAR_AREA);
  const maxWait = Math.max(0, ...hours.map((h) => h.waitMinutes || 0));
  const points = hours
    .map((h, i) => (h.waitMinutes == null || !maxWait ? null : [i * slot + slot / 2, BAR_AREA - (h.waitMinutes / maxWait) * (BAR_AREA - 8) + 4]))
    .filter(Boolean);
  const every = n > 12 ? 3 : n > 8 ? 2 : 1;
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 100 ${CHART_H}`}
        preserveAspectRatio="none"
        className="block h-40 w-full overflow-visible"
        role="img"
        aria-labelledby={labelledBy}
        data-testid="best-time-chart"
      >
        <line x1="0" x2="100" y1={BAR_AREA} y2={BAR_AREA} className="text-border" stroke="currentColor" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        {hours.map((h, i) => {
          const x = i * slot + slot * 0.15;
          const w = slot * 0.7;
          const height = heights[i];
          const isBest = h.hour === bestHour;
          const isNow = h.hour === currentHour;
          return (
            <g key={h.hour} data-hour={h.hour}>
              {isNow ? (
                <rect x={i * slot} y="0" width={slot} height={BAR_AREA} className="text-primary" fill="currentColor" opacity="0.07" />
              ) : null}
              {h.open ? null : (
                <rect x={i * slot} y="0" width={slot} height={BAR_AREA} className="text-text-muted" fill="currentColor" opacity="0.06" />
              )}
              {height > 0 ? (
                <rect
                  x={x}
                  y={BAR_AREA - height}
                  width={w}
                  height={height}
                  rx="0.8"
                  className={cn(levelColor(h.open ? h.level : null), "best-time-bar")}
                  fill="currentColor"
                  opacity={h.open ? 0.9 : 0.35}
                />
              ) : (
                <rect x={x} y={BAR_AREA - 1} width={w} height="1" className="text-border-strong" fill="currentColor" />
              )}
              {isBest ? (
                <rect
                  x={x - slot * 0.08}
                  y={BAR_AREA - Math.max(height, 6) - 2}
                  width={w + slot * 0.16}
                  height={Math.max(height, 6) + 2}
                  rx="1.2"
                  fill="none"
                  className="text-primary"
                  stroke="currentColor"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                  data-testid="best-time-best-bar"
                />
              ) : null}
            </g>
          );
        })}
        {points.length > 1 ? (
          <polyline
            points={points.map((p) => p.join(",")).join(" ")}
            fill="none"
            className="text-info"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <div className="mt-1 grid text-[0.6875rem] text-text-muted" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden="true">
        {hours.map((h, i) => (
          <span key={h.hour} className={cn("text-center tabular-nums", h.hour === currentHour && "font-semibold text-foreground")}>
            {i % every === 0 ? hourLabel(h.hour, locale).replace(/\s/g, "\u202f") : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}

function Legend() {
  const { t } = useI18n();
  const items = [
    ["quiet", t("bestTime.level.quiet")],
    ["moderate", t("bestTime.level.moderate")],
    ["busy", t("bestTime.level.busy")],
  ];
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary" aria-hidden="true">
      {items.map(([level, label]) => (
        <li key={level} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-sm bg-current", levelColor(level))} />
          {label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <svg width="18" height="6" className="text-info" aria-hidden="true">
          <line x1="0" x2="18" y1="3" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
        </svg>
        {t("bestTime.legendWait")}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border-2 border-primary" />
        {t("bestTime.legendBest")}
      </li>
    </ul>
  );
}

function DataTable({ hours, locale }) {
  const { t } = useI18n();
  return (
    <details className="group mt-3 rounded-md border border-border" data-testid="best-time-table">
      <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {t("bestTime.showTable")}
      </summary>
      <div
        className="max-h-72 overflow-auto border-t border-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        tabIndex={0}
        role="region"
        aria-label={t("bestTime.tableCaption")}
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t("bestTime.tableCaption")}</caption>
          <thead className="sticky top-0 bg-card text-xs text-text-secondary">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">{t("bestTime.colHour")}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t("bestTime.colCrowd")}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t("bestTime.colWait")}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t("bestTime.colLevel")}</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h.hour} className="border-t border-border/70" data-testid="best-time-row">
                <th scope="row" className="px-3 py-1.5 font-medium text-foreground">{hourLabel(h.hour, locale)}</th>
                <td className="px-3 py-1.5 tabular-nums">{h.open || h.samples ? h.crowd : "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{h.waitMinutes == null ? "—" : t("visits.waitMinutes", { minutes: h.waitMinutes })}</td>
                <td className="px-3 py-1.5">{h.open ? t(levelKey(h.level)) : t("bestTime.closed")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * "Best time to come" for one queue: weekday picker, chart, text summary,
 * table alternative and a quiet/busy-now badge.
 */
export function BestTimeCard({ queueId, className, headingLevel = "h2" }) {
  const { t, locale } = useI18n();
  const today = campusWeekday();
  const [weekday, setWeekday] = useState(today);
  const { data, loading, error, retry } = useBestTime(queueId, weekday);
  const summaryId = useId();
  const Heading = headingLevel;
  const dayLong = weekdayName(weekday, locale, "long");
  const shown = data?.enough ? visibleHours(data.hours) : [];
  const rec = recommendedHour(data);
  const busiest = data?.enough ? busiestHour(data.hours) : null;
  const isToday = weekday === today;

  return (
    <section className={cn("rounded-md border border-border bg-card p-4 shadow-card", className)} data-testid="best-time-card" aria-labelledby={`${summaryId}-h`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Heading id={`${summaryId}-h`} className="flex items-center gap-1.5 font-heading text-title text-foreground">
          <CalendarClock className="size-4 text-primary" aria-hidden="true" />
          {t("bestTime.title")}
        </Heading>
        {isToday && data?.enough ? <NowBadge now={data.now} /> : null}
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1" role="group" aria-label={t("bestTime.pickDay")} data-testid="best-time-days">
        {WEEKDAYS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setWeekday(d)}
            aria-pressed={d === weekday}
            data-testid={`best-time-day-${d}`}
            className={cn(
              "relative h-9 rounded-md text-xs font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              d === weekday ? "bg-primary text-primary-foreground" : "bg-secondary text-text-secondary hover:text-foreground"
            )}
          >
            <span aria-hidden="true">{weekdayName(d, locale, "short")}</span>
            <span className="sr-only">
              {d === today ? t("bestTime.dayToday", { day: weekdayName(d, locale, "long") }) : weekdayName(d, locale, "long")}
            </span>
            {d === today ? <span className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-current" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>

      <div className="mt-4" aria-live="polite" aria-busy={loading || undefined}>
        {loading && !data ? <Skeleton className="h-40 rounded-md" /> : null}

        {!loading && error ? (
          <div className="flex items-center justify-between gap-3 rounded-md bg-secondary px-3 py-2 text-sm text-text-secondary" data-testid="best-time-error">
            {t("bestTime.error")}
            <Button variant="ghost" size="sm" onClick={retry}>{t("error.retry")}</Button>
          </div>
        ) : null}

        {data && !error && !data.enough ? (
          <div className="flex items-start gap-3 rounded-md bg-secondary/70 px-3 py-4" data-testid="best-time-empty">
            <Hourglass className="mt-0.5 size-5 shrink-0 text-text-secondary" aria-hidden="true" />
            <div>
              <p className="font-medium text-foreground">{t("bestTime.notEnough")}</p>
              <p className="mt-0.5 text-sm text-text-secondary">{t("bestTime.notEnoughHint", { day: dayLong, count: data.minTickets })}</p>
            </div>
          </div>
        ) : null}

        {data && !error && data.enough ? (
          <div className={cn(loading && "opacity-60 transition-opacity")}>
            <p id={summaryId} className="mb-3 text-sm text-foreground" data-testid="best-time-summary">
              {rec ? (
                <span className="inline-flex items-start gap-1.5">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    <strong className="font-semibold" data-testid="best-time-best">
                      {t(isToday && data.nextBest ? "bestTime.bestToday" : "bestTime.bestOn", { day: dayLong, time: hourLabel(rec.hour, locale) })}
                    </strong>
                    {rec.waitMinutes != null ? ` ${t("bestTime.bestWait", { minutes: rec.waitMinutes })}` : ""}
                    {busiest && busiest.hour !== rec.hour ? ` ${t("bestTime.busiest", { time: hourLabel(busiest.hour, locale) })}` : ""}
                  </span>
                </span>
              ) : (
                t("bestTime.noBest")
              )}
            </p>
            <Chart hours={shown} bestHour={rec?.hour} currentHour={isToday ? data.currentHour : null} locale={locale} labelledBy={summaryId} />
            <Legend />
            <DataTable hours={shown} locale={locale} />
            <p className="mt-3 text-xs text-text-muted" data-testid="best-time-basis">
              {t("bestTime.basis", { count: data.sampleSize, days: data.activeDays, weeks: data.lookbackWeeks })}
              {data.scheduleKnown ? "" : ` ${t("bestTime.noSchedule")}`}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
