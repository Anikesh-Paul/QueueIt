import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * QueueIt wordmark — a rounded token-slot mark plus the product name.
 * The mark suggests a numbered place in line without a mascot.
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
      <span className="grid size-7 shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground shadow-card transition-colors group-hover:bg-primary-hover">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="size-4.5"
        >
          <rect x="5" y="4" width="6" height="5" rx="1.5" fill="currentColor" fillOpacity="0.45" />
          <rect x="13" y="4" width="6" height="9" rx="1.5" fill="currentColor" fillOpacity="0.7" />
          <rect x="4.5" y="12" width="15" height="8" rx="2" fill="#CCFBF1" />
        </svg>
      </span>
      <span className="font-heading text-[1.125rem] font-semibold leading-none tracking-[-0.01em] text-foreground">
        QueueIt
      </span>
    </Link>
  );
}