import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { presentCounterServing } from "@/lib/now-serving";
import { nextCounterPlaceholder } from "@/lib/counter-name";

/**
 * Add, rename, or remove counters on the open queue.
 * A queue always keeps at least one counter.
 */
export function AdminCounters({
  counters,
  adminActionBusy,
  adminAddCounter,
  adminRenameCounter,
  adminRemoveCounter,
}) {
  const list = Array.isArray(counters) ? counters : [];
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState({});

  async function handleAdd(event) {
    event.preventDefault();
    const name = newName.trim();
    if (!name || adminActionBusy) return;
    const ok = await adminAddCounter(name);
    if (ok) setNewName("");
  }

  return (
    <section
      data-testid="admin-counters"
      className="rounded-xl border border-border bg-card p-5 shadow-card"
    >
      <h2 className="font-display text-headline font-semibold tracking-[-0.01em] text-foreground">
        Counters
      </h2>
      <p className="mt-1 text-sm text-text-secondary">
        Call and serve can target a counter. Students see which counter is calling them.{" "}
        <Link to="/admin/shift" className="font-medium text-primary underline-offset-4 hover:underline" data-testid="counters-shift-link">
          Breaks and shifts
        </Link>
      </p>

      <ul className="mt-4 flex flex-col gap-3">
        {list.map((counter) => {
          const draft = drafts[counter.id] ?? counter.name;
          return (
            <li
              key={counter.id || counter.name}
              data-testid="admin-counter-row"
              className="flex flex-col gap-2 rounded-lg border border-border bg-secondary px-3.5 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <Label htmlFor={`counter-name-${counter.id}`} className="sr-only">
                  Counter name
                </Label>
                <Input
                  id={`counter-name-${counter.id}`}
                  value={draft}
                  onChange={(event) =>
                    setDrafts((prev) => ({ ...prev, [counter.id]: event.target.value }))
                  }
                  disabled={adminActionBusy}
                  data-testid="counter-name-input"
                />
                <p className="mt-1 text-xs text-text-muted" data-testid="counter-meta">
                  {`${presentCounterServing(counter).label} ${presentCounterServing(counter).value}`}
                  {counter.state && counter.state !== "open" ? (
                    <span
                      className={
                        counter.state === "break"
                          ? "ml-2 rounded-full bg-warning-soft px-1.5 py-0.5 font-semibold text-warning-ink"
                          : "ml-2 rounded-full bg-background px-1.5 py-0.5 font-semibold text-text-secondary"
                      }
                      data-testid="counter-state"
                    >
                      {counter.state === "break" ? "On break" : "Closed"}
                    </span>
                  ) : null}
                  {counter.staffedBy?.name ? ` · ${counter.staffedBy.name}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={adminActionBusy || draft.trim() === counter.name || !draft.trim()}
                  onClick={() => adminRenameCounter(counter.id, draft.trim())}
                  data-testid="counter-rename"
                >
                  Rename
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={adminActionBusy || list.length <= 1}
                  onClick={() => adminRemoveCounter(counter.id)}
                  data-testid="counter-remove"
                >
                  Remove
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <form className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={handleAdd}>
        <div className="min-w-0 flex-1">
          <Label htmlFor="new-counter-name">Add a counter</Label>
          <Input
            id="new-counter-name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={nextCounterPlaceholder(list)}
            disabled={adminActionBusy}
            data-testid="counter-add-name"
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          disabled={adminActionBusy || !newName.trim()}
          data-testid="counter-add"
        >
          Add counter
        </Button>
      </form>
    </section>
  );
}
