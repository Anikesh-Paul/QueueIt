import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DAY_CHIPS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

function daysKey(days) {
  return (days || []).slice().sort((a, b) => a - b).join(",");
}

function presetOf(days) {
  if (!days || days.length === 0) return "every";
  const key = daysKey(days);
  if (key === "1,2,3,4,5") return "weekdays";
  if (key === "0,6") return "weekend";
  return "custom";
}

function daysFromPreset(preset, current) {
  if (preset === "every") return null;
  if (preset === "weekdays") return [1, 2, 3, 4, 5];
  if (preset === "weekend") return [0, 6];
  return current && current.length ? current : [1];
}

function rowFromWindow(window) {
  return {
    start: window.start || "",
    end: window.end || "",
    days: Array.isArray(window.days) && window.days.length ? window.days : null,
  };
}


function isOvernightRow(row) {
  const start = String(row.start || "").trim();
  const end = String(row.end || "").trim();
  const parse = (value) => {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)/.exec(value);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const startMin = parse(start);
  const endMin = parse(end);
  return startMin != null && endMin != null && endMin < startMin;
}

export function AdminServiceWindows({
  queueId,
  adminQueueMeta,
  adminActionBusy,
  adminUpdateServiceWindows,
}) {
  const [windowDraft, setWindowDraft] = useState([]);
  const [windowsDirty, setWindowsDirty] = useState(false);

  useEffect(() => {
    if (windowsDirty) return;
    const rows = Array.isArray(adminQueueMeta?.serviceWindows)
      ? adminQueueMeta.serviceWindows.map(rowFromWindow)
      : [];
    setWindowDraft(rows);
  }, [adminQueueMeta?.serviceWindows, windowsDirty]);

  useEffect(() => {
    setWindowsDirty(false);
  }, [queueId]);

  function updateWindowRow(index, patch) {
    setWindowsDirty(true);
    setWindowDraft((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addWindowRow() {
    setWindowsDirty(true);
    setWindowDraft((rows) => [...rows, { start: "", end: "", days: null }]);
  }

  function removeWindowRow(index) {
    setWindowsDirty(true);
    setWindowDraft((rows) => rows.filter((_, i) => i !== index));
  }

  function normalizeTimeInput(value) {
    const raw = String(value ?? "").trim();
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
    if (!m) return raw;
    return `${m[1].padStart(2, "0")}:${m[2]}`;
  }

  function toggleCustomDay(index, day) {
    const row = windowDraft[index];
    const current = row.days && row.days.length ? row.days : [];
    const next = current.includes(day) ? current.filter((item) => item !== day) : [...current, day];
    updateWindowRow(index, { days: next.length ? next : [day] });
  }

  async function handleSaveWindows(event) {
    event.preventDefault();
    if (adminActionBusy) return;
    const payload = windowDraft.map((row) => ({
      start: normalizeTimeInput(row.start),
      end: normalizeTimeInput(row.end),
      ...(row.days && row.days.length ? { days: row.days } : {}),
    }));
    const ok = await adminUpdateServiceWindows(payload);
    if (ok) setWindowsDirty(false);
  }

  return (
    <section
      className="scroll-mt-28 overflow-hidden rounded-xl border border-border bg-card px-5 py-5 shadow-card"
      data-testid="admin-service-windows"
    >
      <h2 className="text-label uppercase tracking-wide text-text-muted">
        Service windows
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        Times are campus IST. A window may end after midnight on the next campus morning (for example 22:00–02:00). Leave days as Every day, or scope a window to weekdays, weekends, or specific days.
      </p>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={handleSaveWindows}
        data-testid="admin-service-windows-form"
      >
        <ul className="flex flex-col gap-3" data-testid="admin-service-windows-list">
          {windowDraft.length === 0 ? (
            <li className="text-sm text-text-muted" data-testid="admin-service-windows-empty">
              No windows yet — add at least one for auto-close and reopen guidance.
            </li>
          ) : (
            windowDraft.map((row, index) => {
              const preset = presetOf(row.days);
              return (
                <li
                  key={`window-${index}`}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-secondary px-3 py-3"
                  data-testid={`admin-service-window-row-${index}`}
                >
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex min-w-[6.5rem] flex-col gap-1">
                      <Label htmlFor={`sw-start-${index}`} className="text-xs text-text-muted">
                        Starts
                      </Label>
                      <Input
                        id={`sw-start-${index}`}
                        type="time"
                        value={row.start}
                        onChange={(event) => updateWindowRow(index, { start: event.target.value })}
                        disabled={adminActionBusy}
                        data-testid={`admin-service-window-start-${index}`}
                        className="h-10"
                        required
                      />
                    </div>
                    <div className="flex min-w-[6.5rem] flex-col gap-1">
                      <Label htmlFor={`sw-end-${index}`} className="text-xs text-text-muted">
                        Ends
                      </Label>
                      <Input
                        id={`sw-end-${index}`}
                        type="time"
                        value={row.end}
                        onChange={(event) => updateWindowRow(index, { end: event.target.value })}
                        disabled={adminActionBusy}
                        data-testid={`admin-service-window-end-${index}`}
                        className="h-10"
                        required
                      />
                    </div>
                    <div className="flex min-w-[8rem] flex-col gap-1">
                      <Label htmlFor={`sw-days-${index}`} className="text-xs text-text-muted">
                        Days
                      </Label>
                      <select
                        id={`sw-days-${index}`}
                        value={preset}
                        onChange={(event) =>
                          updateWindowRow(index, { days: daysFromPreset(event.target.value, row.days) })
                        }
                        disabled={adminActionBusy}
                        data-testid={`admin-service-window-days-${index}`}
                        className="h-10 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <option value="every">Every day</option>
                        <option value="weekdays">Weekdays</option>
                        <option value="weekend">Weekend</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={adminActionBusy}
                      onClick={() => removeWindowRow(index)}
                      data-testid={`admin-service-window-remove-${index}`}
                    >
                      Remove
                    </Button>
                  </div>
                  {isOvernightRow(row) ? (
                    <p className="text-xs text-text-muted" data-testid={`admin-service-window-overnight-${index}`}>
                      Ends the next campus morning.
                    </p>
                  ) : null}
                  {preset === "custom" ? (
                    <div className="flex flex-wrap gap-1.5" data-testid={`admin-service-window-custom-days-${index}`}>
                      {DAY_CHIPS.map((day) => {
                        const selected = (row.days || []).includes(day.value);
                        return (
                          <button
                            key={day.value}
                            type="button"
                            data-testid={`admin-service-window-day-${index}-${day.value}`}
                            aria-pressed={selected}
                            disabled={adminActionBusy}
                            onClick={() => toggleCustomDay(index, day.value)}
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                              selected
                                ? "bg-primary text-primary-foreground"
                                : "bg-card text-text-secondary ring-1 ring-border"
                            }`}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={adminActionBusy}
            onClick={addWindowRow}
            data-testid="admin-service-window-add"
          >
            Add window
          </Button>
          <Button
            type="submit"
            variant="default"
            size="sm"
            disabled={adminActionBusy}
            data-testid="admin-service-windows-save"
          >
            {adminActionBusy ? "Working…" : "Save windows"}
          </Button>
        </div>
      </form>
    </section>
  );
}
