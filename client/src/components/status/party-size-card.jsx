import { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { partySizeOf, reduceOptions } from "@/lib/party";

/**
 * Status page: who this ticket covers, and (while waiting) a way to make the
 * group smaller. Never larger — that would push back everyone behind.
 * Render with key={partySize} so the picker resets after a change.
 */
export function PartySizeCard({ partySize, canReduce, busy, error, onReduce, t }) {
  const n = partySizeOf({ partySize });
  const options = reduceOptions(n);
  const [pick, setPick] = useState(options.length ? options[options.length - 1] : 1);
  if (n < 2) return null;
  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3" data-testid="status-party" aria-labelledby="status-party-title">
      <h2 id="status-party-title" className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Users className="size-4 text-primary" aria-hidden="true" />
        <span data-testid="status-party-size">{t("party.badge", { count: n })}</span>
      </h2>
      <p className="mt-1 text-sm text-text-secondary">{t("party.estimateNote")}</p>
      {canReduce && options.length ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onReduce?.(pick);
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
            {t("party.reduceLabel")}
            <select
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              value={pick}
              onChange={(event) => setPick(Number(event.target.value))}
              disabled={busy}
              data-testid="party-reduce-select"
            >
              {options.map((size) => (
                <option key={size} value={size}>
                  {size === 1 ? t("party.justMe") : t("party.people", { count: size })}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary" size="sm" disabled={busy} data-testid="party-reduce-submit">
            {busy ? t("party.updating") : t("party.reduceAction")}
          </Button>
          <p className="basis-full text-xs text-text-muted">{t("party.reduceHint")}</p>
        </form>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert" data-testid="party-reduce-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
