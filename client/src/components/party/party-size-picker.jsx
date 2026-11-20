import { useId } from "react";
import { Users } from "lucide-react";
import { useI18n } from "@/context/i18n-context";
import { groupsOf, partyOptions } from "@/lib/party";
import { cn } from "@/lib/utils";

/**
 * "How many people?" on join. Real radio inputs (keyboard arrows work),
 * styled as a segmented control. Hidden when the queue takes one person per ticket.
 */
export function PartySizePicker({ queue, value, onChange, disabled = false, className }) {
  const { t } = useI18n();
  const name = useId();
  const { enabled, maxSize } = groupsOf(queue);
  if (!enabled || maxSize < 2) return null;
  const options = partyOptions(queue);
  return (
    <fieldset className={cn("min-w-0", className)} data-testid="party-size-picker" disabled={disabled}>
      <legend className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Users className="size-4 text-primary" aria-hidden="true" />
        {t("party.legend")}
      </legend>
      <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((n) => (
          <label key={n} className="relative">
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange?.(n)}
              className="peer sr-only"
              data-testid={`party-size-option-${n}`}
            />
            <span
              className={cn(
                "flex h-10 cursor-pointer items-center justify-center rounded-md border border-border bg-secondary px-2 text-sm font-semibold text-text-secondary transition-colors",
                "hover:text-foreground peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground",
                "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
              )}
            >
              {n === 1 ? t("party.justMe") : t("party.people", { count: n })}
            </span>
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-text-muted" data-testid="party-size-hint">
        {t("party.hint", { max: maxSize })}
      </p>
    </fieldset>
  );
}
