import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { GLYPH_VIEWBOX, MARK_COLORS, MARK_DOT, MARK_RING, PLATE_RADIUS } from "./mark-geometry";

/**
 * QueueIt lockup: the ring-and-dot glyph + "QueueIt" set in Fraunces.
 * The logotype uses the serif so the capital I never reads as a lowercase l.
 */
export function Wordmark({ className, to = "/", tone = "default" }) {
  const inverse = tone === "inverse";
  return (
    <Link
      to={to}
      aria-label="QueueIt home"
      className={cn(
        "group inline-flex items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        inverse && "focus-visible:ring-[#b7e4c7]",
        className
      )}
    >
      <QueueItMark
        variant="glyph"
        className={cn(
          "size-[1.375rem] shrink-0 transition-transform duration-200 ease-out group-hover:rotate-[-8deg] motion-reduce:transition-none",
          inverse ? "text-[#f0fdf4]" : "text-primary"
        )}
      />
      <span
        className={cn(
          "font-display text-[1.3125rem] font-semibold leading-none tracking-[-0.02em]",
          inverse ? "text-[#f0fdf4]" : "text-foreground"
        )}
      >
        QueueIt
      </span>
    </Link>
  );
}

/**
 * The QueueIt mark (same geometry as client/public/favicon.svg).
 *
 * variant="glyph" — ring + dot only, filled with currentColor; tight viewBox so
 *   it sizes like an icon. Use for lockups and hero-scale display.
 * variant="plate" — the app-icon form: forest rounded square, light glyph.
 */
export function QueueItMark({ className, variant = "glyph", title }) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  if (variant === "plate") {
    return (
      <svg viewBox="0 0 32 32" className={className} {...a11y}>
        <rect width="32" height="32" rx={PLATE_RADIUS} fill={MARK_COLORS.forest} />
        <g fill={MARK_COLORS.onForest}>
          <path d={MARK_RING} />
          <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox={GLYPH_VIEWBOX} fill="currentColor" className={className} {...a11y}>
      <path d={MARK_RING} />
      <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} />
    </svg>
  );
}
