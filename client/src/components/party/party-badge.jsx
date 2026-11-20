import { Users } from "lucide-react";
import { partySizeOf } from "@/lib/party";
import { cn } from "@/lib/utils";

/**
 * Small "group of N" chip. Renders nothing for a one-person ticket unless `always`.
 * `label` is the full text (translated by the caller); the visible text can be shorter.
 */
export function PartyBadge({ size, label, short = false, always = false, className, testId = "party-badge" }) {
  const n = partySizeOf({ partySize: size });
  if (n < 2 && !always) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-info-ink/20 bg-info-soft px-2 py-0.5 text-xs font-semibold text-info-ink",
        className
      )}
      data-testid={testId}
      data-party-size={n}
      title={label}
    >
      <Users className="size-3.5" aria-hidden="true" />
      {short ? (
        <>
          <span aria-hidden="true">{n}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        label
      )}
    </span>
  );
}
