import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdminServiceWindows({
  queueId,
  adminQueueMeta,
  adminActionBusy,
  adminUpdateServiceWindows,
}) {
  const [windowDraft, setWindowDraft] = useState([]);
  const [windowsDirty, setWindowsDirty] = useState(false);

  // Sync draft from server meta unless the admin is mid-edit.
  useEffect(() => {
    if (windowsDirty) return;
    const rows = Array.isArray(adminQueueMeta?.serviceWindows)
      ? adminQueueMeta.serviceWindows.map((w) => ({
          start: w.start || "",
          end: w.end || "",
        }))
      : [];
    setWindowDraft(rows);
  }, [adminQueueMeta?.serviceWindows, windowsDirty]);

  useEffect(() => {
    setWindowsDirty(false);
  }, [queueId]);

  function updateWindowRow(index, field, value) {
    setWindowsDirty(true);
    setWindowDraft((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function addWindowRow() {
    setWindowsDirty(true);
    setWindowDraft((rows) => [...rows, { start: "", end: "" }]);
  }

  function removeWindowRow(index) {
    setWindowsDirty(true);
    setWindowDraft((rows) => rows.filter((_, i) => i !== index));
  }

  function normalizeTimeInput(value) {
    // HTML time may be HH:mm or HH:mm:ss — API stores HH:mm campus wall time.
    const raw = String(value ?? "").trim();
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
    if (!m) return raw;
    return `${m[1].padStart(2, "0")}:${m[2]}`;
  }

  async function handleSaveWindows(event) {
    event.preventDefault();
    if (adminActionBusy) return;
    const payload = windowDraft.map((row) => ({
      start: normalizeTimeInput(row.start),
      end: normalizeTimeInput(row.end),
    }));
    const ok = await adminUpdateServiceWindows(payload);
    if (ok) setWindowsDirty(false);
  }

  return (
            <section
              className="overflow-hidden rounded-xl border border-border bg-card px-5 py-5 shadow-card"
              data-testid="admin-service-windows"
            >
              <h2 className="text-label uppercase tracking-wide text-text-muted">
                Service windows
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                Daily schedule (same every day). Times are campus IST.
              </p>
              <form
                className="mt-3 flex flex-col gap-3"
                onSubmit={handleSaveWindows}
                data-testid="admin-service-windows-form"
              >
                <ul className="flex flex-col gap-2" data-testid="admin-service-windows-list">
                  {windowDraft.length === 0 ? (
                    <li className="text-sm text-text-muted" data-testid="admin-service-windows-empty">
                      No windows yet — add at least one for auto-close and reopen guidance.
                    </li>
                  ) : (
                    windowDraft.map((row, index) => (
                      <li
                        key={`window-${index}`}
                        className="flex flex-wrap items-end gap-2"
                        data-testid={`admin-service-window-row-${index}`}
                      >
                        <div className="flex min-w-[6.5rem] flex-col gap-1">
                          <Label
                            htmlFor={`sw-start-${index}`}
                            className="text-xs text-text-muted"
                          >
                            Starts
                          </Label>
                          <Input
                            id={`sw-start-${index}`}
                            type="time"
                            value={row.start}
                            onChange={(e) =>
                              updateWindowRow(index, "start", e.target.value)
                            }
                            disabled={adminActionBusy}
                            data-testid={`admin-service-window-start-${index}`}
                            className="h-10"
                            required
                          />
                        </div>
                        <div className="flex min-w-[6.5rem] flex-col gap-1">
                          <Label
                            htmlFor={`sw-end-${index}`}
                            className="text-xs text-text-muted"
                          >
                            Ends
                          </Label>
                          <Input
                            id={`sw-end-${index}`}
                            type="time"
                            value={row.end}
                            onChange={(e) =>
                              updateWindowRow(index, "end", e.target.value)
                            }
                            disabled={adminActionBusy}
                            data-testid={`admin-service-window-end-${index}`}
                            className="h-10"
                            required
                          />
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
                      </li>
                    ))
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
