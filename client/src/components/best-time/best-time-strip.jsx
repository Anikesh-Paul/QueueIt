import { useI18n } from "@/context/i18n-context";
import { cn } from "@/lib/utils";
import { barHeights, hourLabel, levelColor, recommendedHour } from "@/lib/best-time";
import { NowBadge } from "./best-time-card";

/** Compact strip for queue cards: tiny bars for today's open hours, a now badge and the best time. */
export function BestTimeStrip({ data, className }) {
  const { t, locale } = useI18n();
  if (!data?.enough || !data.bars?.length) return null;
  const rec = recommendedHour(data);
  const heights = barHeights(data.bars, 16, 2);
  return (
    <span className={cn("mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1", className)} data-testid="best-time-strip">
      <svg width={data.bars.length * 5} height="18" className="shrink-0" aria-hidden="true">
        {data.bars.map((b, i) => (
          <rect
            key={b.hour}
            x={i * 5}
            y={18 - Math.max(heights[i], 1)}
            width="3.5"
            height={Math.max(heights[i], 1)}
            rx="0.8"
            className={cn(levelColor(b.level), data.now?.hour === b.hour && "text-primary")}
            fill="currentColor"
          />
        ))}
      </svg>
      <NowBadge now={data.now} testId="best-time-strip-now" />
      {rec ? (
        <span className="text-sm text-text-secondary" data-testid="best-time-strip-best">
          {t(data.nextBest ? "bestTime.stripBestToday" : "bestTime.stripBest", { time: hourLabel(rec.hour, locale) })}
        </span>
      ) : null}
    </span>
  );
}
