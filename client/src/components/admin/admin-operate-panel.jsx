import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { campusDatetimeLocalToIso, formatCampusDateTime } from "@/lib/campus-time";
import { formatNowServing } from "@/components/admin/format-now-serving";

export function AdminOperatePanel({
  adminQueueMeta,
  waitingList,
  waitingError,
  adminActionBusy,
  adminActionError,
  selectedEntryId,
  paused,
  acceptingTokens,
  empty,
  adminCall,
  adminServe,
  adminSkip,
  adminPause,
  adminResume,
  adminStopAccepting,
  adminStartAccepting,
  adminExtend,
}) {
  const [extendEndsAt, setExtendEndsAt] = useState("");
  const [reopenOverride, setReopenOverride] = useState("");
  const [skipOpen, setSkipOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [selectedCounterId, setSelectedCounterId] = useState("");

  const counters = Array.isArray(adminQueueMeta?.counters) ? adminQueueMeta.counters : [];
  const multi = counters.length > 1;
  const calledEntries = waitingList.filter((entry) => entry.status === "serving");
  const calledEntry = calledEntries[0] || null;
  const busyIds = new Set(
    calledEntries.map((entry) => entry.servingCounterId).filter(Boolean)
  );
  const freeCounters = counters.filter((counter) => counter.id && !busyIds.has(counter.id));
  const waiterCount = waitingList.filter((entry) => entry.status !== "serving").length;
  const canCall =
    !adminActionBusy &&
    !paused &&
    waiterCount > 0 &&
    (multi ? freeCounters.length > 0 : !calledEntry);

  const freeCounterIds = freeCounters.map((counter) => counter.id).join(",");
  const counterIds = counters.map((counter) => counter.id).join(",");
  useEffect(() => {
    if (!multi) {
      setSelectedCounterId("");
      return;
    }
    const free = freeCounterIds.split(",").filter(Boolean);
    const all = counterIds.split(",").filter(Boolean);
    setSelectedCounterId((prev) => {
      if (prev && free.includes(prev)) return prev;
      return free[0] || all[0] || "";
    });
  }, [multi, freeCounterIds, counterIds]);

  return (
            <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
              <div className="grid grid-cols-2 gap-3 px-5 py-5 sm:max-w-sm">
                <div className="flex flex-col gap-1 rounded-lg border border-border bg-secondary px-4 py-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Now serving
                  </span>
                  {multi ? (
                    <ul className="mt-0.5 flex flex-col gap-1" data-testid="admin-now-serving">
                      {counters.map((counter) => (
                        <li
                          key={counter.id}
                          className="flex items-baseline justify-between gap-2 text-sm"
                          data-testid="admin-counter-serving"
                        >
                          <span className="truncate text-text-secondary">{counter.name}</span>
                          <span className="font-metric text-lg font-bold tabular-nums text-foreground">
                            {formatNowServing(counter.nowServing)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span
                      className="font-metric text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground"
                      data-testid="admin-now-serving"
                    >
                      {formatNowServing(adminQueueMeta?.nowServing)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1 rounded-lg border border-border bg-secondary px-4 py-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Waiting
                  </span>
                  <span
                    className="font-metric text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground"
                    data-testid="admin-waiting-count"
                  >
                    {waiterCount}
                  </span>
                </div>
              </div>

              <div className="border-t border-border px-5 py-4">
                {multi ? (
                  <div className="mb-3" data-testid="counter-picker">
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
                      Target counter
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {counters.map((counter) => {
                        const busy = busyIds.has(counter.id);
                        const selected = selectedCounterId === counter.id;
                        return (
                          <button
                            key={counter.id}
                            type="button"
                            data-testid="counter-option"
                            data-counter-id={counter.id}
                            aria-pressed={selected}
                            onClick={() => setSelectedCounterId(counter.id)}
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                              selected
                                ? "bg-primary text-primary-foreground"
                                : "bg-secondary text-text-secondary hover:bg-secondary/80"
                            }`}
                          >
                            {counter.name}
                            {busy ? " · calling" : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div
                  className="admin-actions grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
                  data-testid="admin-actions"
                >
                  <Button
                    variant="default"
                    size="lg"
                    onClick={() =>
                      adminCall(selectedEntryId || undefined, selectedCounterId || undefined)
                    }
                    disabled={!canCall}
                    data-testid="admin-call"
                    className="w-full sm:w-auto"
                  >
                    {adminActionBusy
                      ? "Working…"
                      : selectedEntryId && (multi ? freeCounters.length > 0 : !calledEntry)
                        ? "Call selected"
                        : "Call next"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() =>
                      adminServe(selectedEntryId || undefined, selectedCounterId || undefined)
                    }
                    disabled={adminActionBusy || paused || empty}
                    data-testid="admin-serve"
                    className="w-full sm:w-auto"
                  >
                    {adminActionBusy
                      ? "Working…"
                      : selectedEntryId
                        ? "Serve selected"
                        : "Serve next"}
                  </Button>
                  <AlertDialog open={skipOpen} onOpenChange={setSkipOpen}>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="secondary"
                        size="lg"
                        disabled={adminActionBusy || paused || empty}
                        data-testid="admin-skip"
                        className="w-full sm:w-auto"
                      >
                        {adminActionBusy
                          ? "Working…"
                          : selectedEntryId
                            ? "Skip selected"
                            : "Skip next"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent data-testid="admin-skip-dialog">
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {selectedEntryId ? "Skip this person?" : "Skip the next person?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          They lose their place in line. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
                        <AlertDialogCancel data-testid="admin-skip-cancel">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          data-testid="admin-skip-confirm"
                          onClick={(event) => {
                            event.preventDefault();
                            setSkipOpen(false);
                            adminSkip(selectedEntryId || undefined, selectedCounterId || undefined);
                          }}
                        >
                          {adminActionBusy ? "Working…" : "Skip"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {paused ? (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={adminResume}
                      disabled={adminActionBusy}
                      data-testid="admin-resume"
                      className="w-full sm:w-auto"
                    >
                      {adminActionBusy ? "Working…" : "Resume"}
                    </Button>
                  ) : (
                    <AlertDialog open={pauseOpen} onOpenChange={setPauseOpen}>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="lg"
                          disabled={adminActionBusy}
                          data-testid="admin-pause"
                          className="w-full sm:w-auto"
                        >
                          {adminActionBusy ? "Working…" : "Pause"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent data-testid="admin-pause-dialog">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Pause this line?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Serving and skip stop until you resume. People can still join.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
                          <AlertDialogCancel data-testid="admin-pause-cancel">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            data-testid="admin-pause-confirm"
                            onClick={(event) => {
                              event.preventDefault();
                              setPauseOpen(false);
                              adminPause();
                            }}
                          >
                            {adminActionBusy ? "Working…" : "Pause"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  {acceptingTokens ? (
                    <AlertDialog open={stopOpen} onOpenChange={setStopOpen}>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="lg"
                          disabled={adminActionBusy}
                          data-testid="admin-stop-accepting"
                          className="col-span-2 w-full sm:col-auto sm:w-auto"
                        >
                          {adminActionBusy ? "Working…" : "Stop accepting tokens"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent data-testid="admin-stop-dialog">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Stop accepting tokens?</AlertDialogTitle>
                          <AlertDialogDescription>
                            New joins will be refused. People already in line keep their place. This is not a reset.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
                          <AlertDialogCancel data-testid="admin-stop-cancel">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            data-testid="admin-stop-confirm"
                            onClick={(event) => {
                              event.preventDefault();
                              const reopenAt = campusDatetimeLocalToIso(reopenOverride);
                              setStopOpen(false);
                              adminStopAccepting(reopenAt ? { reopenAt } : {});
                              setReopenOverride("");
                            }}
                          >
                            {adminActionBusy ? "Working…" : "Stop accepting"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={adminStartAccepting}
                      disabled={adminActionBusy}
                      data-testid="admin-start-accepting"
                      className="col-span-2 w-full sm:col-auto sm:w-auto"
                    >
                      {adminActionBusy ? "Working…" : "Start accepting tokens"}
                    </Button>
                  )}
                </div>

                {acceptingTokens ? (
                  <div className="mt-3 flex flex-col gap-3">
                    <div
                      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
                      data-testid="admin-stop-reopen-panel"
                    >
                      <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                        <Label
                          htmlFor="reopen-override"
                          className="text-xs text-text-muted"
                        >
                          Reopen override (optional, campus IST)
                        </Label>
                        <Input
                          id="reopen-override"
                          type="datetime-local"
                          value={reopenOverride}
                          onChange={(e) => setReopenOverride(e.target.value)}
                          data-testid="admin-reopen-override"
                          disabled={adminActionBusy}
                        />
                      </div>
                      <p className="text-xs text-text-muted sm:pb-2">
                        Leave empty for next scheduled window start.
                      </p>
                    </div>
                    <div
                      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
                      data-testid="admin-extend-panel"
                    >
                      <p className="w-full text-sm text-text-muted">
                        Extend auto-close
                        {adminQueueMeta?.sessionEndsAt
                          ? ` · ends ${formatCampusDateTime(adminQueueMeta.sessionEndsAt)}`
                          : ""}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={adminActionBusy}
                        data-testid="admin-extend-15"
                        onClick={() => adminExtend({ minutes: 15 })}
                      >
                        +15 min
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={adminActionBusy}
                        data-testid="admin-extend-30"
                        onClick={() => adminExtend({ minutes: 30 })}
                      >
                        +30 min
                      </Button>
                      <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                        <Label
                          htmlFor="extend-ends-at"
                          className="text-xs text-text-muted"
                        >
                          Explicit end (campus IST)
                        </Label>
                        <Input
                          id="extend-ends-at"
                          type="datetime-local"
                          value={extendEndsAt}
                          onChange={(e) => setExtendEndsAt(e.target.value)}
                          data-testid="admin-extend-ends-at"
                          disabled={adminActionBusy}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={adminActionBusy || !extendEndsAt}
                        data-testid="admin-extend-apply"
                        onClick={() => {
                          const endsAt = campusDatetimeLocalToIso(extendEndsAt);
                          if (!endsAt) return;
                          adminExtend({ endsAt });
                        }}
                      >
                        Set end
                      </Button>
                    </div>
                  </div>
                ) : null}

                {(waitingError || adminActionError) && (
                  <div className="mt-3 flex flex-col gap-2">
                    {waitingError && <Alert variant="destructive">{waitingError}</Alert>}
                    {adminActionError && (
                      <Alert variant="destructive" data-testid="admin-action-error">
                        {adminActionError}
                      </Alert>
                    )}
                  </div>
                )}
              </div>
            </section>

  );
}
