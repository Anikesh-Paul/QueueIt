import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * QueueIt wordmark — pass-stub + dog-ear mark on forest plate + sans product name.
 * Same glyph as favicon (Mess hall linen / locked plan §2.5).
 */
export function Wordmark({ className, to = "/" }) {
  return (
    <Link
      to={to}
      aria-label="QueueIt home"
      className={cn(
        "group inline-flex items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
    >
      <span
        className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-[10px] shadow-card transition-opacity group-hover:opacity-90"
        aria-hidden="true"
      >
        <PassStubMark className="size-full" />
      </span>
      <span className="font-heading text-[1.125rem] font-semibold leading-none tracking-[-0.01em] text-foreground">
        QueueIt
      </span>
    </Link>
  );
}

/**
 * Pass-stub glyph matching client/public/favicon.svg.
 * Plate #1B4332 · glyph #F0FDF4 — terracotta never in the mark.
 */
export function PassStubMark({ className }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect width="32" height="32" rx="8" fill="#1B4332" />
      <path
        fill="#F0FDF4"
        d="M9.5 8h10.25L24 12.25V22.5A1.75 1.75 0 0 1 22.25 24.25H9.5A1.75 1.75 0 0 1 7.75 22.5v-12.75A1.75 1.75 0 0 1 9.5 8z"
      />
      <path fill="#1B4332" d="M19.75 8v4.25H24L19.75 8z" />
      <path
        fill="none"
        stroke="#F0FDF4"
        strokeWidth="0.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.75 8v4.25H24"
        opacity="0.35"
      />
    </svg>
  );
}
